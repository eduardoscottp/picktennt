import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CommandActor, CommandSnapshot } from '../../lib/tournament-builder/commands';
import { generateRoundRobin } from '../../lib/tournament-builder/modules/round-robin';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';

const admin: CommandActor = { id: 'admin', clientId: 'web', role: 'admin' };
function snapshot(): CommandSnapshot {
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  definition.registration.entry_type = 'singles'; definition.registration.partner_consent = false;
  definition.registration.min_entries = 4; definition.registration.max_entries = 4;
  definition.nodes.find((node: { module: string }) => node.module === 'elimination@1').config.bronze = true;
  const ids = ['a', 'b', 'c', 'd'];
  const entries = ids.map(id => ({ id, playerIds: [`player-${id}`] }));
  const fixtures = generateRoundRobin(entries, definition.event.courts, 'rr');
  return {
    event: { id: 'event', created_by: 'owner', revision: 7, roster_revision: 1, definition_id: 'definition', modular_state: 'active' },
    definitions: [{ id: 'definition', definition }],
    teams: ids.map(id => ({ id, entry_state: 'approved' })),
    team_members: ids.map(id => ({ id: `member-${id}`, team_id: id, user_id: `player-${id}`, membership_status: 'active' })),
    tournament_players: [], rounds: [], standings: [],
    stages: [{ id: 'entries-stage', module_id: 'entries', output: { entryIds: ids } }, { id: 'rr-stage', node_id: 'rr', module_id: 'round_robin' }, { id: 'rank-stage', node_id: 'rank', module_id: 'standings', output: {} }, { id: 'playoff-stage', node_id: 'playoff', module_id: 'elimination' }],
    matches: fixtures.map(fixture => {
      if (fixture.a.kind !== 'entry' || fixture.b.kind !== 'entry') throw new Error('Expected entries');
      const a = fixture.a.entryId, b = fixture.b.entryId, aWins = a < b;
      return { id: fixture.id, stage_id: 'rr-stage', logical_key: fixture.id, status: 'validated', outcome_kind: 'played', team_a_id: a, team_b_id: b, score_a: aWins ? 11 : 5, score_b: aWins ? 5 : 11, winner_team_id: aWins ? a : b };
    }),
  };
}

test('review blocks missing and unvalidated matches and is restricted to admins', () => {
  const data = snapshot();
  assert.throws(() => previewNextStage(data, { id: 'player', clientId: 'web', role: 'player' }), { code: 'FORBIDDEN' });
  assert.throws(() => previewNextStage(data, { id: 'admin', clientId: 'assistant', role: 'admin' }), { code: 'FORBIDDEN' });
  assert.doesNotThrow(() => previewNextStage(data, { id: 'admin', clientId: 'assistant', role: 'admin', permissions: ['admin:manage'] }));
  const underReview = structuredClone(data); underReview.event!.results_under_review = true;
  assert.throws(() => previewNextStage(underReview, admin), { code: 'INVALID_STATE' });
  data.matches[0].status = 'score_entered';
  assert.equal(previewNextStage(data, admin).state, 'blocked');
  data.matches.pop();
  assert.equal(previewNextStage(data, admin).missing_matches, 1);
});

test('review shows ranked semifinals and dependent final and bronze without mutation', () => {
  const data = snapshot(), before = structuredClone(data);
  const review = previewNextStage(data, admin);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected a ready review');
  const fixtures = review.fixtures.flatMap(fixture => 'a' in fixture ? [fixture] : []);
  assert.equal(fixtures.length, 4);
  assert.deepEqual(fixtures.slice(0, 2).map(fixture => [fixture.a, fixture.b]), [
    [{ kind: 'entry', entryId: 'a' }, { kind: 'entry', entryId: 'd' }],
    [{ kind: 'entry', entryId: 'b' }, { kind: 'entry', entryId: 'c' }],
  ]);
  assert.ok(fixtures.some(fixture => fixture.bronze && fixture.a.kind === 'loser'));
  assert.deepEqual(data, before);
  assert.deepEqual(previewNextStage(data, admin), review);
  data.event!.revision = 8;
  const changed = previewNextStage(data, admin);
  if (changed.state !== 'ready') throw new Error('Expected a ready review');
  assert.notEqual(changed.preview_hash, review.preview_hash);
  data.matches.push({ id: 'existing', stage_id: 'playoff-stage', logical_key: 'playoff:r1:m1' });
  const incomplete = previewNextStage(data, admin);
  assert.equal(incomplete.state, 'blocked');
  if (incomplete.state !== 'blocked') throw new Error('Expected a blocked review');
  assert.equal(incomplete.reason, 'SCHEDULE_INCONSISTENT');
  assert.equal(incomplete.missing_matches, 3);
  data.matches.push(...['playoff:r1:m2', 'playoff:r2:m1', 'playoff:bronze'].map(key => ({ id: key, stage_id: 'playoff-stage', logical_key: key })));
  assert.equal(previewNextStage(data, admin).state, 'existing');
  data.matches.push({ id: 'duplicate', stage_id: 'playoff-stage', logical_key: 'playoff:r1:m1' });
  const duplicate = previewNextStage(data, admin);
  assert.equal(duplicate.state, 'blocked');
  if (duplicate.state !== 'blocked') throw new Error('Expected an inconsistent schedule');
  assert.equal(duplicate.reason, 'SCHEDULE_INCONSISTENT');
});

test('a completed round robin without a knockout has no next stage', () => {
  const data = snapshot();
  const definition = data.definitions[0].definition as { nodes: { id: string; module: string; from?: string }[] };
  definition.nodes = definition.nodes.filter(node => !['qualify@1', 'elimination@1'].includes(node.module));
  definition.nodes.find(node => node.module === 'placements@1')!.from = 'rank';
  assert.equal(previewNextStage(data, admin).state, 'finished');
});

test('review previews a vacant semifinal and its automatic route to the final without mutating history', () => {
  const data = snapshot();
  data.teams.find(team => team.id === 'd')!.entry_state = 'withdrawn';
  data.stages.find(stage => stage.module_id === 'entries')!.output = { entryIds: ['a', 'b', 'c', 'd'], qualifierSlots: ['a', 'b', 'c', 'd'] };
  const before = structuredClone(data), review = previewNextStage(data, admin);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected a ready review');
  const fixtures = review.fixtures.flatMap(fixture => 'a' in fixture ? [fixture] : []);
  const semifinal = fixtures.find(fixture => fixture.id === 'playoff:r1:m1')!;
  assert.equal(semifinal.resolved_entry_a, 'a'); assert.equal(semifinal.resolved_entry_b, null);
  assert.equal(semifinal.automatic_outcome, 'walkover'); assert.equal(semifinal.automatic_winner_entry_id, 'a');
  const final = fixtures.find(fixture => fixture.id === 'playoff:r2:m1')!;
  assert.equal(final.resolved_entry_a, 'a'); assert.equal(final.resolved_entry_b, null);
  assert.equal(final.automatic_outcome, null); assert.equal(final.automatic_winner_entry_id, null);
  assert.deepEqual(data, before);
  data.event!.revision = Number(data.event!.revision) + 1;
  const changed = previewNextStage(data, admin);
  if (changed.state !== 'ready') throw new Error('Expected a ready review');
  assert.notEqual(changed.preview_hash, review.preview_hash);
});

test('automatic no-contests and walkovers replay through final and bronze without inventing a winner', () => {
  const data = snapshot();
  for (const team of data.teams) if (team.id !== 'a') team.entry_state = 'withdrawn';
  data.stages.find(stage => stage.module_id === 'entries')!.output = { entryIds: ['a', 'b', 'c', 'd'], qualifierSlots: ['a', 'b', 'c', 'd'] };
  const review = previewNextStage(data, admin);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected a ready review');
  const outcomes = review.fixtures.flatMap(fixture => 'a' in fixture ? [fixture] : []).map(fixture => [fixture.id, fixture.automatic_outcome, fixture.automatic_winner_entry_id]);
  assert.deepEqual(outcomes, [
    ['playoff:r1:m1', 'walkover', 'a'], ['playoff:r1:m2', 'no_contest', null],
    ['playoff:r2:m1', 'walkover', 'a'], ['playoff:bronze', 'no_contest', null],
  ]);
});
