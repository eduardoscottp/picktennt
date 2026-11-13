import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import type { FixtureResult } from '../../lib/tournament-builder/types';
import { planGraphRuntime } from '../../lib/tournament-builder/graph-command-runtime';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';

for (const mode of ['round_robin', 'cross_play'] as const) for (const withdrawn of [['d'], ['c', 'd']]) test(`${mode} automatic outcomes with ${withdrawn.length} withdrawn entries`, () => {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  d.schema_version = '2.0'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
  d.registration.min_entries = d.registration.max_entries = 4;
  d.nodes = [
    { id: 'reg', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'reg' },
    ...(mode === 'round_robin' ? [{ id: 'pool', module: 'round_robin@2' as const, inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed' as const, seed })) }] : [{ id: 'pool', module: 'cross_play@1' as const, side_a: [1, 2].map(seed => ({ kind: 'seed' as const, seed })), side_b: [3, 4].map(seed => ({ kind: 'seed' as const, seed })) }]),
    { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  const ids = ['a', 'b', 'c', 'd'];
  const entries = ids.map(id => ({ id, playerIds: [`player-${id}`] }));
  const options = { eligibleEntryIds: ids.filter(id => !withdrawn.includes(id)) };
  const initial = analyzeGraph(d, entries, [], options);
  const outcomes: FixtureResult[] = initial.resolvedFixtures.filter(fixture => fixture.fixture.stageId === 'pool').map(({ fixture }) => {
    if (fixture.a.kind !== 'entry' || fixture.b.kind !== 'entry') throw new Error('Expected seed entries');
    const a = fixture.a.entryId, b = fixture.b.entryId, active = [a, b].filter(id => !withdrawn.includes(id));
    if (active.length < 2) return { fixtureId: fixture.id, accepted: true, outcome: active.length ? 'walkover' : 'no_contest', winnerEntryId: active[0] ?? null, scoreA: null, scoreB: null };
    return { fixtureId: fixture.id, accepted: true, outcome: 'played', winnerEntryId: a < b ? a : b, scoreA: a < b ? 11 : 5, scoreB: a < b ? 5 : 11 };
  });
  const result = analyzeGraph(d, entries, outcomes, options);
  const pool = result.graphStages.pool;
  assert.equal(pool.state, mode === 'round_robin' ? 'completed' : 'blocked');
  if (mode === 'round_robin') assert.deepEqual(pool.ties, withdrawn.length === 1 ? [] : [['c', 'd']]);
  assert.equal(pool.rows!.length, 4);
  assert.deepEqual(pool.rows!.map(row => row.entryId), mode === 'cross_play' && withdrawn.length === 1 ? ['a', 'b', 'd', 'c'] : ids);
  for (const id of withdrawn) {
    const row = pool.rows!.find(item => item.entryId === id)!;
    assert.equal(row.wins, 0);
    assert.equal(row.losses, mode === 'round_robin' ? ids.length - withdrawn.length : 2);
  }
  const final = result.resolvedFixtures.find(fixture => fixture.fixture.stageId === 'final')!;
  if (mode === 'round_robin') { assert.equal(final.entryA, 'a'); assert.equal(final.entryB, 'b'); }
  else { assert.equal(final.entryA, undefined); assert.equal(final.entryB, undefined); }
  if (mode === 'cross_play' && withdrawn.length === 1) {
    const rankedThird = structuredClone(d);
    const match = rankedThird.nodes.find(node => node.id === 'final')!;
    if (match.module !== 'match@1') throw new Error('Expected final');
    match.inputs[1] = { kind: 'rank', node_id: 'pool', rank: 3 };
    const reviewed = analyzeGraph(rankedThird, entries, outcomes, options);
    assert.equal(reviewed.resolvedFixtures.find(fixture => fixture.fixture.stageId === 'final')!.entryB, 'c');
    assert.ok(reviewed.graphStages.pool.rows!.some(row => row.entryId === 'd'), 'Historical withdrawn row is preserved');
  }
});

test('synthetic deferred RR plan with one withdrawn qualifier', () => {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  d.schema_version = '2.0'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
  d.registration.min_entries = d.registration.max_entries = 4;
  const rank = (rank: number) => ({ kind: 'rank' as const, node_id: 'initial', rank });
  d.nodes = [
    { id: 'reg', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'reg' },
    { id: 'initial', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed' as const, seed })) },
    { id: 'pool', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(rank) },
    { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  const ids = ['a', 'b', 'c', 'd'], entries = ids.map(id => ({ id, playerIds: [`player-${id}`] }));
  const initial = analyzeGraph(d, entries, []);
  const matches = initial.fixtures.filter(fixture => fixture.stageId === 'initial').map(fixture => {
    if (fixture.a.kind !== 'entry' || fixture.b.kind !== 'entry') throw new Error('Expected seed entries');
    const a = fixture.a.entryId, b = fixture.b.entryId, win = a < b;
    return { id: `saved-${fixture.id}`, stage_id: 'stage-initial', round_id: 'round-initial', logical_key: fixture.id, is_current: true, status: 'validated', outcome_kind: 'played', team_a_id: a, team_b_id: b, score_a: win ? 11 : 5, score_b: win ? 5 : 11, winner_team_id: win ? a : b, result_revision: 6 };
  });
  const snapshot: CommandSnapshot = {
    event: { id: 'event', created_by: 'owner', revision: 7, roster_revision: 1, definition_id: 'definition', modular_state: 'active' },
    definitions: [{ id: 'definition', definition: d }], teams: ids.map(id => ({ id, entry_state: id === 'd' ? 'withdrawn' : 'approved' })),
    team_members: ids.map(id => ({ id: `member-${id}`, team_id: id, user_id: `player-${id}`, membership_status: 'active' })), tournament_players: [],
    stages: d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', output: node.module === 'entries@1' ? { entryIds: ids, graphNextStageApproved: true } : {} })),
    rounds: [{ id: 'round-initial', stage_id: 'stage-initial', logical_wave: 1, round_number: 1, is_current: true }], matches, standings: [],
  };
  const accepted = matches.map(match => ({ fixtureId: match.logical_key, accepted: true, outcome: 'played' as const, winnerEntryId: match.winner_team_id, scoreA: match.score_a, scoreB: match.score_b }));
  const fixtures = analyzeGraph(d, entries, accepted, { eligibleEntryIds: ['a', 'b', 'c'] }).fixtures.map(fixture => fixture.id);
  let sequence = 0;
  const plan = planGraphRuntime(snapshot, d, { id: 'owner', clientId: 'web', role: 'owner' }, { now: '2026-10-29T00:00:00Z', id: () => `new-${++sequence}` }, 8, new Set(), new Set(fixtures));
  assert.equal(plan.effects.matches!.filter(match => match.stage_id === 'stage-pool' && match.outcome_kind === 'walkover').length, 3);
  assert.equal(plan.effects.matches!.find(match => match.stage_id === 'stage-final')!.status, 'scheduled');
});
