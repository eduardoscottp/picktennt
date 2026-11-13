import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CommandActor, CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewGraphNextStage, simulateGraphNextStage } from '../../lib/tournament-builder/graph-next-stage-preview';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import { planGraphRuntime } from '../../lib/tournament-builder/graph-command-runtime';
import { graphSupportsStageReview } from '../../lib/tournament-builder/graph-generation-policy';
import { graphRankLocks } from '../../lib/tournament-builder/graph-rank-locks';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

const admin: CommandActor = { id: 'admin', clientId: 'web', role: 'admin' };
function setup() {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  d.schema_version = '2.0'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
  d.registration.min_entries = d.registration.max_entries = 4;
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'rr', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed' as const, seed })) },
    { id: 's1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'rr', rank: 1 }, { kind: 'rank', node_id: 'rr', rank: 4 }] },
    { id: 's2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'rr', rank: 2 }, { kind: 'rank', node_id: 'rr', rank: 3 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }] },
    { id: 'bronze', module: 'match@1', inputs: [{ kind: 'loser', node_id: 's1' }, { kind: 'loser', node_id: 's2' }] },
    { id: 'places', module: 'placements@2', final: 'final', bronze: 'bronze' },
  ];
  const ids = ['a', 'b', 'c', 'd'];
  const entries = ids.map(id => ({ id, playerIds: [`player-${id}`] }));
  const analysis = analyzeGraph(d, entries, []);
  const stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ids } } : {}) }));
  const snapshot: CommandSnapshot = {
    event: { id: 'event', created_by: 'owner', revision: 7, roster_revision: 1, definition_id: 'definition', modular_state: 'active' },
    definitions: [{ id: 'definition', definition: d }], teams: ids.map(id => ({ id, entry_state: 'approved' })),
    team_members: ids.map(id => ({ id: `member-${id}`, team_id: id, user_id: `player-${id}`, membership_status: 'active' })),
    tournament_players: [], rounds: [], standings: [], stages,
    matches: analysis.resolvedFixtures.map(f => ({ id: `saved-${f.fixture.id}`, logical_key: f.fixture.id, stage_id: `stage-${f.fixture.stageId}`, status: 'scheduled', team_a_id: f.entryA ?? null, team_b_id: f.entryB ?? null })),
  };
  return { d, snapshot };
}
function finishRoundRobin(s: CommandSnapshot) {
  for (const match of s.matches.filter(match => match.stage_id === 'stage-rr')) {
    const a = String(match.team_a_id), b = String(match.team_b_id), aWins = a < b;
    Object.assign(match, { status: 'validated', outcome_kind: 'played', score_a: aWins ? 11 : 5, score_b: aWins ? 5 : 11, winner_team_id: aWins ? a : b });
  }
}

test('graph review uses existing fixtures, blocks missing data, and never mutates', () => {
  const { d, snapshot } = setup();
  const before = structuredClone(snapshot);
  assert.throws(() => previewGraphNextStage(snapshot, { id: 'player', clientId: 'web', role: 'player' }, d), { code: 'FORBIDDEN' });
  assert.throws(() => previewGraphNextStage(snapshot, { id: 'admin', clientId: 'assistant', role: 'admin' }, d), { code: 'FORBIDDEN' });
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'existing');
  assert.equal(review.pending_results, 6);
  assert.equal(review.fixtures.length, 4);
  assert.deepEqual(snapshot, before);
  snapshot.matches.pop();
  const missing = previewGraphNextStage(snapshot, admin, d);
  assert.equal(missing.state, 'blocked'); assert.equal(missing.missing_matches, 1);
});

test('temporary policy matches storage support for initial and deferred block types', () => {
  const { d, snapshot } = setup();
  assert.equal(graphSupportsStageReview(d, snapshot.stages), true);
  const cross = structuredClone(d);
  const rr = cross.nodes.find(node => node.id === 'rr')!;
  if (rr.module !== 'round_robin@2') throw new Error('Expected group');
  cross.nodes[cross.nodes.indexOf(rr)] = { id: 'rr', module: 'cross_play@1', side_a: rr.inputs.slice(0, 2), side_b: rr.inputs.slice(2) };
  assert.equal(graphSupportsStageReview(cross, snapshot.stages), true);
  const laterGroup = structuredClone(d);
  const semifinal = laterGroup.nodes.find(node => node.id === 's1')!;
  if (semifinal.module !== 'match@1') throw new Error('Expected match');
  laterGroup.nodes[laterGroup.nodes.indexOf(semifinal)] = { id: 's1', module: 'round_robin@2', inputs: semifinal.inputs };
  assert.equal(graphSupportsStageReview(laterGroup, snapshot.stages), true);
  const manual = structuredClone(snapshot.stages);
  manual.find(stage => stage.node_id === 's1')!.output = { manualMatchEntries: { a: 'a' } };
  assert.equal(graphSupportsStageReview(d, manual), true, 'A manual assignment must not silently release deferred fixtures');
});

test('graph review resolves ranks and preserves winner and loser routes', () => {
  const { d, snapshot } = setup();
  finishRoundRobin(snapshot);
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'existing'); assert.equal(review.pending_results, 0);
  const semi = review.fixtures.find(fixture => fixture.stage_id === 's1')!;
  assert.deepEqual([semi.team_a_id, semi.team_b_id], ['a', 'd']);
  assert.deepEqual(semi.side_sources, [{ kind: 'rank', node_id: 'rr', rank: 1 }, { kind: 'rank', node_id: 'rr', rank: 4 }]);
  assert.deepEqual(review.fixtures.find(fixture => fixture.kind === 'final')!.side_sources, [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }]);
  assert.deepEqual(review.fixtures.find(fixture => fixture.kind === 'bronze')!.side_sources, [{ kind: 'loser', node_id: 's1' }, { kind: 'loser', node_id: 's2' }]);
});

test('a new graph does not generate when qualifying ranks remain tied', () => {
  const { d, snapshot } = setup();
  snapshot.matches = snapshot.matches.filter(match => match.stage_id === 'stage-rr');
  finishRoundRobin(snapshot);
  const match = snapshot.matches.find(row => [row.team_a_id, row.team_b_id].includes('a') && [row.team_a_id, row.team_b_id].includes('d'))!;
  const dOnA = match.team_a_id === 'd';
  Object.assign(match, { score_a: dOnA ? 11 : 5, score_b: dOnA ? 5 : 11, winner_team_id: 'd' });
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'blocked');
  if (review.state !== 'blocked') throw new Error('Expected a tie blocker');
  assert.equal(review.reason, 'UNRESOLVED_TIE');
});

test('review blocks rank eligibility that the storage boundary cannot verify', () => {
  const { d, snapshot } = setup();
  snapshot.matches = snapshot.matches.filter(match => match.stage_id === 'stage-rr');
  finishRoundRobin(snapshot);
  snapshot.disciplinary_excluded_team_ids = ['a'];
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'blocked');
  if (review.state !== 'blocked') throw new Error('Expected blocked review');
  assert.equal(review.reason, 'UNSUPPORTED_FORMAT');
});

test('review also blocks an unverifiable disciplinary exclusion in a direct seed', () => {
  const { d, snapshot } = setup();
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'q1', module: 'match@1', inputs: [1, 2].map(seed => ({ kind: 'seed', seed })) },
    { id: 'pool', module: 'round_robin@2', inputs: [{ kind: 'winner', node_id: 'q1' }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] },
    { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'pool', rank })) },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'] } } : {}) }));
  snapshot.matches = [{ id: 'm1', logical_key: 'q1:match', stage_id: 'stage-q1', status: 'validated', outcome_kind: 'played', winner_team_id: 'a', score_a: 11, score_b: 3, team_a_id: 'a', team_b_id: 'b' }];
  snapshot.disciplinary_excluded_team_ids = ['c'];
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'blocked');
  if (review.state !== 'blocked') throw new Error('Expected blocked review');
  assert.equal(review.reason, 'UNSUPPORTED_FORMAT');
});

test('a new deferred group blocks unexpected saved draws or withdrawal exclusions', () => {
  for (const kind of ['draw', 'exclusion'] as const) {
    const { d, snapshot } = setup();
    d.nodes = [
      { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
      { id: 'rr', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })) },
      { id: 'pool', module: 'round_robin@2', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'rr', rank })) },
      { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'pool', rank })) },
      { id: 'places', module: 'placements@2', final: 'final' },
    ];
    snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'], ...(kind === 'exclusion' ? { excludedByNode: { pool: ['a'] } } : {}) } } : node.id === 'pool' && kind === 'draw' ? { output: { rankingDraws: [{ inputRevision: 0, entryIds: ['a', 'b'] }] } } : {}) }));
    snapshot.matches = snapshot.matches.filter(match => match.stage_id === 'stage-rr');
    finishRoundRobin(snapshot);
    const before = structuredClone(snapshot), review = previewGraphNextStage(snapshot, admin, d);
    assert.equal(review.state, 'blocked');
    if (review.state !== 'blocked') throw new Error('Expected blocked review');
    assert.equal(review.reason, 'UNSUPPORTED_FORMAT');
    assert.deepEqual(snapshot, before);
  }
});

test('an unrelated tie does not block unambiguous qualifying positions', () => {
  const { d, snapshot } = setup();
  d.registration.min_entries = d.registration.max_entries = 5;
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'rr', module: 'round_robin@2', inputs: [1, 2, 3, 4, 5].map(seed => ({ kind: 'seed' as const, seed })) },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'rr', rank: 1 }, { kind: 'rank', node_id: 'rr', rank: 2 }] },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const entries = ids.map(id => ({ id, playerIds: [`player-${id}`] }));
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ids } } : {}) }));
  snapshot.teams = ids.map(id => ({ id, entry_state: 'approved' }));
  snapshot.team_members = ids.map(id => ({ id: `member-${id}`, team_id: id, user_id: `player-${id}`, membership_status: 'active' }));
  snapshot.matches = analyzeGraph(d, entries, []).resolvedFixtures.filter(fixture => fixture.fixture.stageId === 'rr').map(fixture => {
    const a = String(fixture.entryA), b = String(fixture.entryB), pair = [a, b].sort().join('');
    const winner = pair === 'ce' ? 'e' : pair[0];
    return { id: `saved-${fixture.fixture.id}`, logical_key: fixture.fixture.id, stage_id: 'stage-rr', status: 'validated', outcome_kind: 'played', team_a_id: a, team_b_id: b, score_a: a === winner ? 11 : 5, score_b: b === winner ? 11 : 5, winner_team_id: winner };
  });
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected an unambiguous final');
  assert.deepEqual([review.fixtures[0].team_a_id, review.fixtures[0].team_b_id], ['a', 'b']);
});

test('new graph waits for review before materializing later blocks and then keeps their identities', () => {
  const { d, snapshot } = setup();
  snapshot.matches = []; snapshot.event!.modular_state = 'ready';
  let sequence = 0;
  const context = { now: '2026-10-28T16:00:00.000Z', id: () => `id-${++sequence}` };
  const apply = (plan: ReturnType<typeof planGraphRuntime>) => {
    if (plan.effects.event) Object.assign(snapshot.event!, plan.effects.event);
    for (const table of ['stages', 'rounds', 'matches', 'standings'] as const) for (const patch of plan.effects[table] ?? []) {
      const row = snapshot[table].find(item => item.id === patch.id);
      if (row) Object.assign(row, patch); else snapshot[table].push(patch);
    }
  };
  apply(planGraphRuntime(snapshot, d, admin, context, 8));
  snapshot.event!.modular_state = 'active';
  assert.equal(snapshot.matches.length, 6);
  assert.ok(snapshot.matches.every(match => match.stage_id === 'stage-rr'));
  const blocked = previewGraphNextStage(snapshot, admin, d);
  assert.equal(blocked.state, 'blocked'); assert.equal(blocked.pending_results, 6);
  finishRoundRobin(snapshot);
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected a ready review');
  assert.equal(review.fixtures.length, 4);
  assert.ok(review.fixtures.every(fixture => fixture.match_id === null));
  const entries = snapshot.stages.find(stage => stage.module_id === 'entries')!;
  entries.output = { ...(entries.output as object), graphNextStageApproved: true };
  const generation = planGraphRuntime(snapshot, d, admin, context, 9, new Set(), new Set(review.fixtures.map(fixture => fixture.id)));
  const patches = generation.effects.matches ?? [];
  for (const feeder of patches) for (const field of ['bracket_next_winner_match_id', 'bracket_next_loser_match_id']) {
    if (typeof feeder[field] !== 'string') continue;
    const successor = patches.findIndex(patch => patch.id === feeder[field]);
    if (successor >= 0) assert.ok(successor < patches.indexOf(feeder), 'Successor must be inserted before its feeder');
  }
  apply(generation);
  assert.equal(snapshot.matches.length, 10);
  const ids = snapshot.matches.map(match => match.id).sort();
  apply(planGraphRuntime(snapshot, d, admin, context, 10));
  assert.deepEqual(snapshot.matches.map(match => match.id).sort(), ids);
  assert.equal(previewGraphNextStage(snapshot, admin, d).state, 'existing');
});

test('an existing graph keeps its precreated fixtures without a new approval flag', () => {
  const { d, snapshot } = setup();
  finishRoundRobin(snapshot);
  const before = snapshot.matches.map(match => match.id).sort();
  let sequence = 0;
  const plan = planGraphRuntime(snapshot, d, admin, { now: '2026-10-28T16:00:00.000Z', id: () => `new-${++sequence}` }, 8);
  assert.ok((plan.effects.matches ?? []).every(match => before.includes(match.id)));
  assert.equal(previewGraphNextStage(snapshot, admin, d).state, 'existing');
});

test('withdrawal after fixtures were created preserves the fixed rank slots', () => {
  const { d, snapshot } = setup();
  finishRoundRobin(snapshot);
  const results = snapshot.matches.filter(match => match.stage_id === 'stage-rr').map(match => ({ fixtureId: String(match.logical_key), accepted: true, outcome: 'played' as const, winnerEntryId: String(match.winner_team_id), scoreA: Number(match.score_a), scoreB: Number(match.score_b) }));
  const analysis = analyzeGraph(d, ['a', 'b', 'c', 'd'].map(id => ({ id, playerIds: [`player-${id}`] })), results);
  for (const resolved of analysis.resolvedFixtures) {
    const saved = snapshot.matches.find(match => match.logical_key === resolved.fixture.id)!;
    saved.team_a_id = resolved.entryA ?? null; saved.team_b_id = resolved.entryB ?? null;
  }
  snapshot.teams.find(team => team.id === 'a')!.entry_state = 'withdrawn';
  let sequence = 0;
  const plan = planGraphRuntime(snapshot, d, admin, { now: '2026-10-28T16:00:00Z', id: () => `fixed-${++sequence}` }, 8);
  const semi = plan.effects.matches!.find(match => match.id === 'saved-s1:match')!;
  assert.equal('team_a_id' in semi ? semi.team_a_id : snapshot.matches.find(match => match.id === 'saved-s1:match')!.team_a_id, 'a');
  assert.equal('team_b_id' in semi ? semi.team_b_id : snapshot.matches.find(match => match.id === 'saved-s1:match')!.team_b_id, 'd');
  assert.equal(semi.outcome_kind, 'walkover');
  assert.equal(semi.winner_team_id, 'd');
});

test('a materialized rank vacancy stays empty after another withdrawal', () => {
  const { d, snapshot } = setup();
  finishRoundRobin(snapshot);
  const entries = ['a', 'b', 'c', 'd'].map(id => ({ id, playerIds: [`player-${id}`] }));
  const results = snapshot.matches.filter(match => match.stage_id === 'stage-rr').map(match => ({ fixtureId: String(match.logical_key), accepted: true, outcome: 'played' as const, winnerEntryId: String(match.winner_team_id), scoreA: Number(match.score_a), scoreB: Number(match.score_b) }));
  const source = snapshot.stages.find(stage => stage.node_id === 'rr')!;
  source.state = 'completed'; source.output = { rows: analyzeGraph(d, entries, results).graphStages.rr.rows };
  Object.assign(snapshot.matches.find(match => match.logical_key === 's1:match')!, { team_a_id: 'c', team_b_id: null, status: 'walkover', outcome_kind: 'walkover', winner_team_id: 'c' });
  Object.assign(snapshot.matches.find(match => match.logical_key === 's2:match')!, { team_a_id: 'd', team_b_id: null, status: 'walkover', outcome_kind: 'walkover', winner_team_id: 'd' });
  const options = { eligibleEntryIds: ['d'], allowIncompleteRoster: true };
  const locks = graphRankLocks(d, entries, options, snapshot.stages, snapshot.matches);
  assert.equal(locks?.rr?.[1], 'c');
  assert.equal(locks?.rr?.[4], null);
  const replay = analyzeGraph(d, entries, results, { ...options, lockedRanks: locks });
  assert.equal(replay.resolvedFixtures.find(fixture => fixture.fixture.id === 's1:match')!.entryB, null);
});

test('an initial manual assignment does not silently generate a deferred final', () => {
  const { d, snapshot } = setup();
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'q1', module: 'match@1', inputs: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }] },
    { id: 'q2', module: 'match@1', inputs: [{ kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'q1' }, { kind: 'winner', node_id: 'q2' }] },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'] } } : {}) }));
  snapshot.matches = []; snapshot.rounds = []; snapshot.standings = []; snapshot.event!.modular_state = 'ready';
  let sequence = 0; const context = { now: '2026-10-28T16:00:00Z', id: () => `manual-${++sequence}` };
  const initial = planGraphRuntime(snapshot, d, admin, context, 8);
  for (const table of ['stages', 'rounds', 'matches', 'standings'] as const) for (const patch of initial.effects[table] ?? []) {
    const row = snapshot[table].find(item => item.id === patch.id);
    if (row) Object.assign(row, patch); else snapshot[table].push(patch);
  }
  const feeder = snapshot.stages.find(stage => stage.node_id === 'q1')!;
  feeder.output = { ...(feeder.output as object), manualMatchEntries: { a: 'a' } };
  snapshot.event!.modular_state = 'active';
  const after = planGraphRuntime(snapshot, d, admin, context, 9);
  assert.ok(!(after.effects.matches ?? []).some(match => match.logical_key === 'final:match'));
  assert.equal(snapshot.matches.length, 2);
});

test('multi-group review waits for initial sources used beyond the immediate frontier', () => {
  const { d, snapshot } = setup();
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'a', module: 'round_robin@2', inputs: [1, 2].map(seed => ({ kind: 'seed', seed })) },
    { id: 'b', module: 'round_robin@2', inputs: [3, 4].map(seed => ({ kind: 'seed', seed })) },
    { id: 'pool1', module: 'round_robin@2', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'a', rank })) },
    { id: 'pool2', module: 'round_robin@2', inputs: [{ kind: 'rank', node_id: 'pool1', rank: 1 }, { kind: 'rank', node_id: 'b', rank: 1 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'pool2', rank: 1 }, { kind: 'rank', node_id: 'b', rank: 2 }] },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'] } } : {}) }));
  const analysis = analyzeGraph(d, ['a', 'b', 'c', 'd'].map(id => ({ id, playerIds: [`player-${id}`] })), []);
  snapshot.matches = analysis.resolvedFixtures.filter(item => ['a', 'b'].includes(item.fixture.stageId)).map(item => ({ id: `saved-${item.fixture.id}`, logical_key: item.fixture.id, stage_id: `stage-${item.fixture.stageId}`, status: 'scheduled', team_a_id: item.entryA, team_b_id: item.entryB }));
  Object.assign(snapshot.matches.find(match => match.stage_id === 'stage-a')!, { status: 'validated', outcome_kind: 'played', score_a: 11, score_b: 3, winner_team_id: 'a' });
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'blocked');
  if (review.state !== 'blocked') throw new Error('Expected pending result');
  assert.equal(review.reason, 'RESULTS_INCOMPLETE');
  assert.equal(review.pending_results, 1);
});

test('an initial no-contest feeding a future group is reviewed as a vacant route', () => {
  const { d, snapshot } = setup();
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'q1', module: 'match@1', inputs: [1, 2].map(seed => ({ kind: 'seed', seed })) },
    { id: 'q2', module: 'match@1', inputs: [3, 4].map(seed => ({ kind: 'seed', seed })) },
    { id: 'pool', module: 'round_robin@2', inputs: ['q1', 'q2'].map(node_id => ({ kind: 'winner', node_id })) },
    { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'pool', rank })) },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'] } } : {}) }));
  snapshot.teams.filter(team => ['a', 'b'].includes(team.id)).forEach(team => { team.entry_state = 'withdrawn'; });
  snapshot.matches = [
    { id: 'm1', logical_key: 'q1:match', stage_id: 'stage-q1', status: 'validated', outcome_kind: 'no_contest', winner_team_id: null, team_a_id: 'a', team_b_id: 'b' },
    { id: 'm2', logical_key: 'q2:match', stage_id: 'stage-q2', status: 'validated', outcome_kind: 'played', winner_team_id: 'c', score_a: 11, score_b: 3, team_a_id: 'c', team_b_id: 'd' },
  ];
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected reviewed no-contest route');
  assert.ok(review.fixtures.some(fixture => 'outcome_kind' in fixture && fixture.outcome_kind === 'walkover'));
});

test('graph generation with two withdrawn qualifiers derives walkovers and a bronze no-contest', () => {
  const { d, snapshot } = setup();
  snapshot.matches = snapshot.matches.filter(match => match.stage_id === 'stage-rr');
  finishRoundRobin(snapshot);
  for (const id of ['a', 'b']) snapshot.teams.find(team => team.id === id)!.entry_state = 'withdrawn';
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected a reviewed automatic outcome');
  if (!('champion_entry_id' in review)) throw new Error('Expected simulated outcomes');
  const before = structuredClone(snapshot);
  const ids = ['s1:match', 's2:match', 'final:match', 'bronze:match'];
  const simulation = simulateGraphNextStage(snapshot, admin, d, ids);
  assert.equal(simulation.matches.find(match => match.id === 's1:match')!.outcome_kind, 'walkover');
  assert.equal(simulation.matches.find(match => match.id === 's2:match')!.outcome_kind, 'walkover');
  assert.equal(simulation.matches.find(match => match.id === 'bronze:match')!.outcome_kind, 'no_contest');
  assert.deepEqual([simulation.matches.find(match => match.id === 'final:match')!.team_a_id, simulation.matches.find(match => match.id === 'final:match')!.team_b_id], ['c', 'd']);
  assert.deepEqual(simulateGraphNextStage(snapshot, admin, d, ids), simulation);
  assert.deepEqual(snapshot, before);
  assert.equal(review.fixtures.find(fixture => fixture.id === 'bronze:match')?.outcome_kind, 'no_contest');
  assert.deepEqual([review.fixtures.find(fixture => fixture.id === 's1:match')?.side_a_eligible, review.fixtures.find(fixture => fixture.id === 's1:match')?.side_b_eligible], [true, null]);
  assert.equal(review.fixtures.find(fixture => fixture.id === 'final:match')?.team_a_id, 'c');
  const roster = snapshot.stages.find(stage => stage.module_id === 'entries')!;
  roster.output = { ...(roster.output as object), graphNextStageApproved: true };
  let sequence = 0;
  const allowed = new Set(ids);
  const plan = planGraphRuntime(snapshot, d, admin, { now: '2026-10-28T16:00:00.000Z', id: () => `auto-${++sequence}` }, 8, new Set(), allowed);
  const matches = plan.effects.matches ?? [];
  assert.equal(matches.find(match => match.logical_key === 's1:match')!.outcome_kind, 'walkover');
  assert.equal(matches.find(match => match.logical_key === 's2:match')!.outcome_kind, 'walkover');
  assert.equal(matches.find(match => match.logical_key === 'bronze:match')!.outcome_kind, 'no_contest');
  assert.deepEqual([matches.find(match => match.logical_key === 'final:match')!.team_a_id, matches.find(match => match.logical_key === 'final:match')!.team_b_id], ['c', 'd']);
});

test('simulation includes an automatic final and champion after three withdrawals', () => {
  const { d, snapshot } = setup();
  snapshot.matches = snapshot.matches.filter(match => match.stage_id === 'stage-rr');
  finishRoundRobin(snapshot);
  for (const id of ['a', 'b', 'c']) snapshot.teams.find(team => team.id === id)!.entry_state = 'withdrawn';
  const review = previewGraphNextStage(snapshot, admin, d);
  if (review.state !== 'ready') throw new Error('Expected a reviewed automatic outcome');
  if (!('champion_entry_id' in review)) throw new Error('Expected simulated outcomes');
  assert.equal(review.fixtures.find(fixture => fixture.id === 's2:match')?.outcome_kind, 'no_contest');
  assert.equal(review.fixtures.find(fixture => fixture.id === 'final:match')?.outcome_kind, 'walkover');
  assert.equal(review.fixtures.find(fixture => fixture.id === 'final:match')?.winner_team_id, 'd');
  assert.equal(review.champion_entry_id, 'd');
  const copy = structuredClone(snapshot);
  const roster = copy.stages.find(stage => stage.module_id === 'entries')!;
  roster.output = { ...(roster.output as object), graphNextStageApproved: true };
  let sequence = 0;
  const plan = planGraphRuntime(copy, d, admin, { now: '2026-10-28T16:00:00.000Z', id: () => `auto-${++sequence}` }, 8, new Set(), new Set(['s1:match', 's2:match', 'final:match', 'bronze:match']));
  assert.equal((plan.effects.stages?.find(stage => stage.id === 'stage-final')?.output as { loserEntryId: unknown }).loserEntryId, null);
  assert.ok('preview_hash' in review && typeof review.preview_hash === 'string');
  assert.deepEqual(previewGraphNextStage(snapshot, admin, d), review);
  snapshot.event!.revision = 8;
  const changed = previewGraphNextStage(snapshot, admin, d);
  assert.ok('preview_hash' in changed && changed.preview_hash !== review.preview_hash);
});

test('partial or duplicated saved graphs cannot regenerate outside an explicit reviewed replay', () => {
  const { d, snapshot } = setup();
  finishRoundRobin(snapshot);
  const context = { now: '2026-10-28T16:00:00.000Z', id: () => crypto.randomUUID() };
  const final = snapshot.matches.find(match => match.logical_key === 'final:match')!;
  snapshot.matches = snapshot.matches.filter(match => match.id !== final.id);
  assert.throws(() => planGraphRuntime(snapshot, d, admin, context, 8), { code: 'SCHEDULE_INCONSISTENT' });
  assert.throws(() => planGraphRuntime(snapshot, d, admin, context, 8, new Set(), new Set(['bronze:match'])), { code: 'SCHEDULE_INCONSISTENT' });
  const reviewed = planGraphRuntime(snapshot, d, admin, context, 8, new Set(), new Set(['final:match']));
  assert.equal((reviewed.effects.matches ?? []).filter(match => match.logical_key === 'final:match').length, 1);
  snapshot.matches.push({ ...snapshot.matches[0], id: 'duplicate' });
  assert.throws(() => planGraphRuntime(snapshot, d, admin, context, 8, new Set(), new Set(['final:match'])), { code: 'SCHEDULE_INCONSISTENT' });
});

test('a direct knockout waits for its seeded matches before reviewing downstream fixtures', () => {
  const { d, snapshot } = setup();
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 's1', module: 'match@1', inputs: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 4 }] },
    { id: 's2', module: 'match@1', inputs: [{ kind: 'seed', seed: 2 }, { kind: 'seed', seed: 3 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }] },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = snapshot.stages.filter(stage => d.nodes.some(node => node.id === stage.node_id));
  snapshot.matches = []; snapshot.event!.modular_state = 'ready';
  let sequence = 0;
  const plan = planGraphRuntime(snapshot, d, admin, { now: '2026-10-28T16:00:00.000Z', id: () => `id-${++sequence}` }, 8);
  snapshot.matches.push(...(plan.effects.matches ?? []));
  snapshot.event!.modular_state = 'active';
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'blocked'); assert.equal(review.pending_results, 2);
});

test('a direct final has no deferred stage and completes normally', () => {
  const { d, snapshot } = setup();
  d.registration.min_entries = d.registration.max_entries = 2;
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }] },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = snapshot.stages.filter(stage => d.nodes.some(node => node.id === stage.node_id));
  snapshot.stages.find(stage => stage.module_id === 'entries')!.output = { entryIds: ['a', 'b'] };
  snapshot.teams = snapshot.teams.filter(team => ['a', 'b'].includes(team.id));
  snapshot.team_members = snapshot.team_members.filter(member => ['a', 'b'].includes(String(member.team_id)));
  snapshot.matches = []; snapshot.rounds = []; snapshot.standings = []; snapshot.event!.modular_state = 'ready';
  let sequence = 0;
  const context = { now: '2026-10-28T16:00:00.000Z', id: () => `id-${++sequence}` };
  const apply = (plan: ReturnType<typeof planGraphRuntime>) => {
    if (plan.effects.event) Object.assign(snapshot.event!, plan.effects.event);
    for (const table of ['stages', 'rounds', 'matches', 'standings'] as const) for (const patch of plan.effects[table] ?? []) {
      const row = snapshot[table].find(item => item.id === patch.id);
      if (row) Object.assign(row, patch); else snapshot[table].push(patch);
    }
  };
  apply(planGraphRuntime(snapshot, d, admin, context, 8));
  snapshot.event!.modular_state = 'active';
  assert.equal(snapshot.matches.length, 1);
  Object.assign(snapshot.matches[0], { status: 'validated', outcome_kind: 'played', score_a: 11, score_b: 5, winner_team_id: 'a' });
  apply(planGraphRuntime(snapshot, d, admin, context, 9));
  assert.equal(snapshot.event!.modular_state, 'completed');
  assert.equal(snapshot.stages.find(stage => stage.node_id === 'places')!.state, 'completed');
  assert.equal(previewGraphNextStage(snapshot, admin, d).state, 'finished');
});

for (const mode of ['pool', 'cross'] as const) test(`an existing dependent ${mode} preserves its saved fixtures`, () => {
  const { d, snapshot } = setup();
  const rank = (rank: number) => ({ kind: 'rank' as const, node_id: 'rr', rank });
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'rr', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed' as const, seed })) },
    ...(mode === 'pool' ? [{ id: 'next', module: 'round_robin@2' as const, inputs: [rank(1), rank(2), rank(3)] }] : [{ id: 'next', module: 'cross_play@1' as const, side_a: [rank(1), rank(2)], side_b: [rank(3), rank(4)] }]),
    { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'next', rank: 1 }, { kind: 'rank', node_id: 'next', rank: 2 }] },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'] } } : {}) }));
  snapshot.matches = []; snapshot.rounds = []; snapshot.standings = []; snapshot.event!.modular_state = 'ready';
  let sequence = 0;
  const context = { now: '2026-10-28T16:00:00.000Z', id: () => `id-${++sequence}` };
  const fixtureIds = analyzeGraph(d, ['a', 'b', 'c', 'd'].map(id => ({ id, playerIds: [`player-${id}`] })), []).fixtures.map(fixture => fixture.id);
  const first = planGraphRuntime(snapshot, d, admin, context, 8, new Set(), new Set(fixtureIds));
  for (const table of ['stages', 'rounds', 'matches', 'standings'] as const) for (const patch of first.effects[table] ?? []) {
    const row = snapshot[table].find(item => item.id === patch.id);
    if (row) Object.assign(row, patch); else snapshot[table].push(patch);
  }
  snapshot.event!.modular_state = 'active';
  finishRoundRobin(snapshot);
  const after = planGraphRuntime(snapshot, d, admin, context, 9);
  assert.ok((after.effects.matches ?? []).some(match => match.stage_id === 'stage-next'));
  assert.ok((after.effects.standings ?? []).some(row => row.stage_id === 'stage-next'));
  const review = previewGraphNextStage(snapshot, admin, d);
  assert.equal(review.state, 'existing');
  if (review.state !== 'existing') throw new Error('Expected an existing schedule');
  assert.equal(review.compatibility_mode, false);
  const pairs = review.fixtures.filter(fixture => fixture.stage_id === 'next').map(fixture => fixture.side_sources.map(source => source.kind === 'rank' ? source.rank : 0).sort((a, b) => a - b).join(':')).sort();
  assert.deepEqual(pairs, mode === 'pool' ? ['1:2', '1:3', '2:3'] : ['1:3', '1:4', '2:3', '2:4']);
});

test('synthetic planner contract for a pool fed by initial matches', () => {
  const { d, snapshot } = setup();
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 's1', module: 'match@1', inputs: [1, 4].map(seed => ({ kind: 'seed' as const, seed })) },
    { id: 's2', module: 'match@1', inputs: [2, 3].map(seed => ({ kind: 'seed' as const, seed })) },
    { id: 'pool', module: 'round_robin@2', inputs: ['s1', 's2'].map(node_id => ({ kind: 'winner' as const, node_id })) },
    { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  snapshot.stages = d.nodes.map(node => ({ id: `stage-${node.id}`, node_id: node.id, module_id: node.module.split('@')[0], state: 'waiting', ...(node.module === 'entries@1' ? { output: { entryIds: ['a', 'b', 'c', 'd'] } } : {}) }));
  snapshot.matches = []; snapshot.rounds = []; snapshot.standings = []; snapshot.event!.modular_state = 'ready';
  let sequence = 0;
  const context = { now: '2026-10-28T16:00:00.000Z', id: () => `id-${++sequence}` };
  const initial = planGraphRuntime(snapshot, d, admin, context, 8);
  for (const table of ['stages', 'rounds', 'matches', 'standings'] as const) for (const patch of initial.effects[table] ?? []) {
    const row = snapshot[table].find(item => item.id === patch.id);
    if (row) Object.assign(row, patch); else snapshot[table].push(patch);
  }
  snapshot.matches = snapshot.matches.filter(match => ['stage-s1', 'stage-s2'].includes(String(match.stage_id)));
  snapshot.rounds = snapshot.rounds.filter(round => ['stage-s1', 'stage-s2'].includes(String(round.stage_id)));
  snapshot.standings = [];
  snapshot.event!.modular_state = 'active';
  for (const match of snapshot.matches) Object.assign(match, { status: 'validated', outcome_kind: 'played', score_a: 11, score_b: 5, winner_team_id: match.team_a_id });
  const roster = snapshot.stages.find(stage => stage.module_id === 'entries')!;
  roster.output = { ...(roster.output as Record<string, unknown>), graphNextStageApproved: true };
  const missing = new Set(['pool:r1:m1', 'final:match']);
  const plan = planGraphRuntime(snapshot, d, admin, context, 9, new Set(), missing);
  assert.ok(plan.effects.matches?.some(match => match.stage_id === 'stage-pool'));
  assert.ok(plan.effects.standings?.some(row => row.stage_id === 'stage-pool'));
});
