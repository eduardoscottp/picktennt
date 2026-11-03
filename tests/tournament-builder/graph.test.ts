import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import { validateGraph } from '../../lib/tournament-builder/graph-validate';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import { graphPreview } from '../../lib/tournament-builder/graph-preview';
import type { FixtureResult } from '../../lib/tournament-builder/types';
const seed = (seed: number) => ({ kind: 'seed' as const, seed });
const winner = (node_id: string) => ({ kind: 'winner' as const, node_id });
test('consolation branches must finish even when placements node appears earlier', () => {
  const d = graphDefinition();
  d.nodes.push({ id: 'consolation', module: 'round_robin@2', inputs: ['a', 'b', 'c', 'd'].map(node_id => ({ kind: 'rank', node_id, rank: 2 })) });
  assert.deepEqual(validateGraph(d), []);
  const results: FixtureResult[] = [];
  for (let step = 0; step < 3; step++) {
    const a = analyzeGraph(d, roster, results);
    for (const f of a.resolvedFixtures.filter(f => f.state === 'ready' && f.fixture.stageId !== 'consolation')) {
      const aWins = Number(f.entryA!.slice(1)) < Number(f.entryB!.slice(1));
      results.push({ fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: aWins ? f.entryA : f.entryB, scoreA: aWins ? 11 : 0, scoreB: aWins ? 0 : 11 });
    }
  }
  const pending = analyzeGraph(d, roster, results);
  assert.equal(pending.graphStages.final.state, 'completed');
  assert.notEqual(pending.state, 'completed');
  for (const f of pending.resolvedFixtures.filter(f => f.state === 'ready'))
    results.push({ fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: f.entryA, scoreA: 11, scoreB: 0 });
  assert.equal(analyzeGraph(d, roster, results).state, 'completed');
});
export function graphDefinition(): GraphDefinition {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  d.schema_version = '2.0';
  d.registration.min_entries = 16;
  d.registration.max_entries = 16;
  d.event.courts = 4;
  d.nodes = [{ id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' }, ...['a', 'b', 'c', 'd'].map((id, i) => ({ id, module: 'round_robin@2', inputs: Array.from({ length: 4 }, (_, j) => seed(i * 4 + j + 1)) })), { id: 'semi1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'a', rank: 1 }, { kind: 'rank', node_id: 'b', rank: 1 }] }, { id: 'semi2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'c', rank: 1 }, { kind: 'rank', node_id: 'd', rank: 1 }] }, { id: 'final', module: 'match@1', inputs: [winner('semi1'), winner('semi2')] }, { id: 'placements', module: 'placements@2', final: 'final' }];
  return d;
}
const roster = Array.from({ length: 16 }, (_, i) => ({ id: `e${i + 1}`, playerIds: [`p${i + 1}a`, `p${i + 1}b`] }));
test('an absent completed pool rank requests an audited walkover after withdrawal', () => {
  const d = graphDefinition();
  d.registration.min_entries = 4;
  d.registration.max_entries = 4;
  d.nodes = [
    { id: 'registration', module: 'registration@1' },
    { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'a', module: 'round_robin@2', inputs: [seed(1), seed(2), seed(3), seed(4)] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'a', rank: 3 }, { kind: 'rank', node_id: 'a', rank: 4 }] },
    { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  const teams = roster.slice(0, 4);
  const results: FixtureResult[] = analyzeGraph(d, teams, []).resolvedFixtures.filter(f => f.fixture.stageId === 'a').map(f => {
    const aWins = Number(f.entryA!.slice(1)) < Number(f.entryB!.slice(1));
    return { fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: aWins ? f.entryA : f.entryB, scoreA: aWins ? 11 : 0, scoreB: aWins ? 0 : 11 };
  });
  const options = { eligibleEntryIds: ['e1', 'e2', 'e3'], excludedByNode: { a: ['e4'] } };
  const pending = analyzeGraph(d, teams, results, options);
  const final = pending.resolvedFixtures.find(f => f.fixture.stageId === 'final')!;
  assert.equal(final.state, 'ready');
  assert.equal(final.entryA, 'e3');
  assert.equal(final.entryB, null);
  assert.equal(final.requiredOutcome, 'walkover');
  assert.notEqual(pending.state, 'completed');
  results.push({ fixtureId: final.fixture.id, accepted: true, outcome: 'walkover', winnerEntryId: 'e3' });
  const complete = analyzeGraph(d, teams, results, options);
  assert.equal(complete.graphStages.final.state, 'completed');
  assert.equal(complete.state, 'completed');
});
test('four pools materialize 27 stable fixtures with independent scheduling and complete placements', () => {
  const d = graphDefinition();
  assert.deepEqual(validateGraph(d), []);
  const a = analyzeGraph(d, roster, []);
  assert.equal(a.fixtures.length, 27);
  assert.equal(a.graphStages.final.state, 'waiting');
  assert.equal(a.resolvedFixtures.filter(f => f.state === 'ready').length, 24);
  for (const wave of new Set(a.fixtures.map(f => f.wave))) {
    const fs = a.fixtures.filter(f => f.wave === wave);
    assert.equal(new Set(fs.map(f => f.court)).size, fs.length);
    const ids = fs.flatMap(f => [f.a, f.b].flatMap(s => s.kind === 'entry' && s.entryId ? [s.entryId] : []));
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.ok(a.fixtures.find(f => f.stageId === 'b')!.wave < Math.max(...a.fixtures.filter(f => f.stageId === 'a').map(f => f.wave)));
  assert.equal(graphPreview(d).maximumMatches, 27);
  const results: FixtureResult[] = [];
  for (let step = 0; step < 3; step++) {
    const next = analyzeGraph(d, roster, results);
    for (const f of next.resolvedFixtures.filter(f => f.state === 'ready'))
      results.push({ fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: f.entryA, scoreA: 11, scoreB: 0 });
  }
  const complete = analyzeGraph(d, roster, results);
  assert.equal(complete.state, 'completed');
  assert.equal(complete.placements?.championEntryId, 'e1');
  assert.equal(complete.placements?.groups?.find(g => g.rank === 3)?.entryIds.length, 2);
  assert.equal(complete.placements?.groups?.find(g => g.rank === 5)?.entryIds.length, 12);
  assert.deepEqual(complete.fixtures.map(f => f.id), a.fixtures.map(f => f.id));
});
test('rejects duplicate ports and unknown fields', () => {
  const d = graphDefinition();
  const pool = d.nodes.find(n => n.id === 'b');
  if (pool?.module === 'round_robin@2')
    pool.inputs[0] = seed(1);
  assert.ok(validateGraph(d).length);
  const unknown = graphDefinition();
  Object.assign(unknown.nodes[2], { unexpected: true });
  assert.ok(validateGraph(unknown).length);
});
test('rejects cycles, missing references, wrong output types and invalid cardinality', () => {
  for (const source of [winner('final'),winner('missing'),winner('a')]) {
    const d=graphDefinition(),semi=d.nodes.find(n=>n.id==='semi1');
    if(semi?.module==='match@1')semi.inputs[0]=source;
    assert.ok(validateGraph(d).length);
  }
  const d=graphDefinition(),semi=d.nodes.find(n=>n.id==='semi1');
  if(semi?.module==='match@1')semi.inputs.pop();
  assert.ok(validateGraph(d).length);
  assert.ok(validateGraph({...graphDefinition(),registration:undefined} as unknown as GraphDefinition).length);
  const tooLarge=graphDefinition();
  tooLarge.nodes.push(...Array.from({length:65},(_,i)=>({id:`extra${i}`,module:'registration@1' as const})));
  assert.ok(validateGraph(tooLarge).length);
});
test('results must be unique, known, legal and cannot precede a feeder', () => {
  const d = graphDefinition(), f = analyzeGraph(d, roster, []).resolvedFixtures[0];
  const result: FixtureResult = { fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: f.entryA, scoreA: 11, scoreB: 0 };
  assert.throws(() => analyzeGraph(d, roster, [result, result]));
  assert.throws(() => analyzeGraph(d, roster, [{ ...result, fixtureId: 'unknown' }]));
  assert.throws(() => analyzeGraph(d, roster, [{ ...result, scoreA: 10 }]));
  assert.throws(() => analyzeGraph(d, roster, [{ ...result, fixtureId: 'final:match' }]));
});
test('ties are local, only affected rank ports wait, and draw revisions cannot be recycled', () => {
  const d = graphDefinition();
  d.registration.min_entries = 6;
  d.registration.max_entries = 6;
  d.nodes = [{ id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' }, ...['a', 'b'].map((id, i) => ({ id, module: 'round_robin@2' as const, inputs: [seed(i * 3 + 1), seed(i * 3 + 2), seed(i * 3 + 3)] })), { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'a', rank: 1 }, { kind: 'rank', node_id: 'b', rank: 1 }] }, { id: 'placements', module: 'placements@2', final: 'final' }];
  const teams = roster.slice(0, 6), first = analyzeGraph(d, teams, []);
  const results: FixtureResult[] = first.resolvedFixtures.filter(f => f.fixture.stageId !== 'final').map(f => { const top = f.fixture.stageId === 'a' ? 'e1' : 'e4'; return f.entryA === top || f.entryB === top ? { fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: top, scoreA: f.entryA === top ? 11 : 0, scoreB: f.entryB === top ? 11 : 0 } : { fixtureId: f.fixture.id, accepted: true, outcome: 'no_contest' }; });
  const next = analyzeGraph(d, teams, results);
  assert.equal(next.graphStages.a.state, 'blocked');
  assert.equal(next.graphStages.final.state, 'ready');
  const final = d.nodes.find(n => n.id === 'final');
  if (final?.module === 'match@1')
    final.inputs[0] = { kind: 'rank', node_id: 'a', rank: 2 };
  assert.equal(analyzeGraph(d, teams, results).graphStages.final.state, 'waiting');
  const options = { stageInputs: { a: { inputRevision: 2, rankingDraws: [{ inputRevision: 1, entryIds: ['e2', 'e3'] }] } } };
  assert.equal(analyzeGraph(d, teams, results, options).graphStages.final.state, 'waiting');
  options.stageInputs.a.rankingDraws[0].inputRevision = 2;
  assert.equal(analyzeGraph(d, teams, results, options).graphStages.final.state, 'ready');
});
test('pool-to-pool and semifinal losers to bronze compose without fixture regeneration', () => {
  const d = graphDefinition();
  d.nodes.splice(8, 0, { id: 'bronze', module: 'match@1', inputs: [{ kind: 'loser', node_id: 'semi1' }, { kind: 'loser', node_id: 'semi2' }] });
  const placements = d.nodes.find(n => n.module === 'placements@2');
  if (placements?.module === 'placements@2')
    placements.bronze = 'bronze';
  assert.deepEqual(validateGraph(d), []);
  let results: FixtureResult[] = [];
  for (let step = 0; step < 3; step++) {
    const a = analyzeGraph(d, roster, results);
    results = results.concat(a.resolvedFixtures.filter(f => f.state === 'ready').map(f => ({ fixtureId: f.fixture.id, accepted: true, outcome: 'played' as const, winnerEntryId: f.entryA, scoreA: 11, scoreB: 0 })));
  }
  const complete = analyzeGraph(d, roster, results);
  assert.equal(complete.state, 'completed');
  assert.equal(complete.fixtures.length, 28);
  assert.equal(complete.placements?.groups?.find(g => g.rank === 3)?.entryIds.length, 1);
  assert.equal(complete.placements?.groups?.find(g => g.rank === 4)?.entryIds.length, 1);
  const pooled = graphDefinition();
  pooled.nodes = pooled.nodes.filter(n => !['semi1', 'semi2', 'final'].includes(n.id));
  pooled.nodes.splice(6, 0, { id: 'second', module: 'round_robin@2', inputs: ['a', 'b', 'c', 'd'].map(node_id => ({ kind: 'rank', node_id, rank: 1 })) }, { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'second', rank: 1 }, { kind: 'rank', node_id: 'second', rank: 2 }] });
  assert.deepEqual(validateGraph(pooled), []);
  const initial = analyzeGraph(pooled, roster, []);
  assert.equal(initial.fixtures.length, 31);
  assert.equal(initial.graphStages.second.state, 'waiting');
  assert.ok(initial.fixtures.filter(f => f.stageId === 'second').every(f => f.wave > Math.max(...initial.fixtures.filter(f => ['a', 'b', 'c', 'd'].includes(f.stageId)).map(f => f.wave))));
});
test('cross-seeded top-two semifinal outputs remain disjoint through the final', () => {
  const d = graphDefinition();
  d.registration.min_entries = 8;
  d.registration.max_entries = 8;
  d.nodes = d.nodes.filter(n => !['c', 'd'].includes(n.id));
  const first = d.nodes.find(n => n.id === 'semi1');
  const second = d.nodes.find(n => n.id === 'semi2');
  if (first?.module === 'match@1') first.inputs = [{ kind: 'rank', node_id: 'a', rank: 1 }, { kind: 'rank', node_id: 'b', rank: 2 }];
  if (second?.module === 'match@1') second.inputs = [{ kind: 'rank', node_id: 'a', rank: 2 }, { kind: 'rank', node_id: 'b', rank: 1 }];
  assert.deepEqual(validateGraph(d), []);
  const teams = roster.slice(0, 8), results: FixtureResult[] = [];
  const ids = analyzeGraph(d, teams, []).fixtures.map(f => f.id);
  assert.equal(ids.length, 15);
  for (let step = 0; step < 3; step++) {
    const next = analyzeGraph(d, teams, results);
    for (const f of next.resolvedFixtures.filter(f => f.state === 'ready')) {
      const aWins = Number(f.entryA!.slice(1)) < Number(f.entryB!.slice(1));
      results.push({ fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: aWins ? f.entryA : f.entryB, scoreA: aWins ? 11 : 0, scoreB: aWins ? 0 : 11 });
    }
  }
  const complete = analyzeGraph(d, teams, results);
  assert.equal(complete.state, 'completed');
  assert.deepEqual(complete.fixtures.map(f => f.id), ids);
  // The same ranked output can still collide when one path feeds the other.
  const final = d.nodes.find(n => n.id === 'final');
  if (final?.module === 'match@1') final.inputs[1] = { kind: 'rank', node_id: 'a', rank: 1 };
  assert.ok(validateGraph(d).some(issue => issue.message.includes('consumed only once')));
});

test('cross-play creates only games between its two sides and exposes ranked outputs', () => {
  const d = graphDefinition();
  d.registration.min_entries = 8;
  d.registration.max_entries = 8;
  d.nodes = [
    { id: 'registration', module: 'registration@1' },
    { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'cross', module: 'cross_play@1', side_a: [seed(1), seed(2), seed(3), seed(4)], side_b: [seed(5), seed(6), seed(7), seed(8)] },
    { id: 'semi1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'cross', rank: 1 }, { kind: 'rank', node_id: 'cross', rank: 4 }] },
    { id: 'semi2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'cross', rank: 2 }, { kind: 'rank', node_id: 'cross', rank: 3 }] },
    { id: 'final', module: 'match@1', inputs: [winner('semi1'), winner('semi2')] },
    { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  assert.deepEqual(validateGraph(d), []);
  const fixtures = analyzeGraph(d, roster.slice(0, 8), []).fixtures.filter(f => f.stageId === 'cross');
  assert.equal(fixtures.length, 16);
  assert.ok(fixtures.every(f => Number(f.a.kind === 'entry' ? f.a.entryId.slice(1) : -1) <= 4));
  assert.ok(fixtures.every(f => Number(f.b.kind === 'entry' ? f.b.entryId.slice(1) : -1) >= 5));
});

test('explicit seeded match blocks support internal pairings and four advancing winners', () => {
  const d = graphDefinition();
  d.registration.min_entries = 9;
  d.registration.max_entries = 9;
  const qualifiers = [[9, 1], [8, 2], [7, 3], [6, 4]].map(([high, low], index) => ({
    id: `qualifier${index + 1}`,
    module: 'match@1' as const,
    inputs: [{ kind: 'rank' as const, node_id: 'group', rank: high }, { kind: 'rank' as const, node_id: 'group', rank: low }],
  }));
  d.nodes = [
    { id: 'registration', module: 'registration@1' },
    { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'group', module: 'round_robin@2', inputs: Array.from({ length: 9 }, (_, index) => seed(index + 1)) },
    ...qualifiers,
    { id: 'semi1', module: 'match@1', inputs: [winner('qualifier1'), winner('qualifier4')] },
    { id: 'semi2', module: 'match@1', inputs: [winner('qualifier2'), winner('qualifier3')] },
    { id: 'final', module: 'match@1', inputs: [winner('semi1'), winner('semi2')] },
    { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  assert.deepEqual(validateGraph(d), []);
  const groupResults = analyzeGraph(d, roster.slice(0, 9), []).resolvedFixtures.filter(f => f.fixture.stageId === 'group').map(f => {
    const aWins = Number(f.entryA!.slice(1)) < Number(f.entryB!.slice(1));
    return { fixtureId: f.fixture.id, accepted: true, outcome: 'played' as const, winnerEntryId: aWins ? f.entryA : f.entryB, scoreA: aWins ? 11 : 0, scoreB: aWins ? 0 : 11 };
  });
  const analysis = analyzeGraph(d, roster.slice(0, 9), groupResults);
  assert.deepEqual(analysis.fixtures.filter(f => f.stageId.startsWith('qualifier')).map(f => [f.a, f.b]), [
    [{ kind: 'entry', entryId: 'e9' }, { kind: 'entry', entryId: 'e1' }],
    [{ kind: 'entry', entryId: 'e8' }, { kind: 'entry', entryId: 'e2' }],
    [{ kind: 'entry', entryId: 'e7' }, { kind: 'entry', entryId: 'e3' }],
    [{ kind: 'entry', entryId: 'e6' }, { kind: 'entry', entryId: 'e4' }],
  ]);
});
