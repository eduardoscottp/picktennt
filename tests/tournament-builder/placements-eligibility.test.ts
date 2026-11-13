import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import { generateElimination, resolveBracket } from '../../lib/tournament-builder/modules/elimination';
import { computePlacements } from '../../lib/tournament-builder/modules/placements';
import type { FixtureResult } from '../../lib/tournament-builder/types';

const roster = ['a', 'b', 'c', 'd'].map(id => ({ id, playerIds: [`p-${id}`] }));
const score = (fixtureId: string, winnerEntryId: string): FixtureResult => ({ fixtureId, accepted: true, outcome: 'played', winnerEntryId, scoreA: 11, scoreB: 5 });

test('v1 preserves the recorded final but excludes an ineligible runner-up', () => {
  const fixtures = generateElimination(roster.slice(0, 2), 1, { seeding: 'ranked', bronze: false });
  const results = [score(fixtures[0].id, 'a')];
  const bracket = resolveBracket(fixtures, results, ['a']);
  assert.equal(bracket.fixtures[0].loserEntryId, 'b');
  const placements = computePlacements(bracket);
  assert.deepEqual(placements.groups, [{ rank: 1, entryIds: ['a'] }]);
  assert.deepEqual(placements.ineligibleEntryIds, ['b']);
  assert.deepEqual(placements.unplacedEntryIds, ['b']);
  assert.deepEqual(bracket.fixtures[0].result, results[0]);
  assert.equal(computePlacements(resolveBracket(fixtures, results, ['b'])).blockedCode, 'NO_ELIGIBLE_CHAMPION');
});

test('v1 leaves nominal final and bronze positions vacant when their historical participants are ineligible', () => {
  const fixtures = generateElimination(roster, 2, { seeding: 'ranked', bronze: true });
  const results = [score('elimination:r1:m1', 'a'), score('elimination:r1:m2', 'b'), score('elimination:r2:m1', 'a'), score('elimination:bronze', 'd')];
  // Bronze is D vs C. Change only the historical score, not the result.
  const bracket = resolveBracket(fixtures, results, ['a', 'c']);
  const placements = computePlacements(bracket);
  assert.deepEqual(placements.groups, [{ rank: 1, entryIds: ['a'] }, { rank: 4, entryIds: ['c'] }]);
  assert.deepEqual(new Set(placements.ineligibleEntryIds), new Set(['b', 'd']));
  assert.deepEqual(bracket.fixtures.find(fixture => fixture.fixture.bronze)?.result, results[3]);
});

function graph(bronze: boolean): GraphDefinition {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  d.schema_version = '2.0'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
  d.registration.min_entries = 4; d.registration.max_entries = 4;
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 's1', module: 'match@1', inputs: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }] },
    { id: 's2', module: 'match@1', inputs: [{ kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }] },
    ...(bronze ? [{ id: 'bronze', module: 'match@1', inputs: [{ kind: 'loser', node_id: 's1' }, { kind: 'loser', node_id: 's2' }] }] : []),
    { id: 'placements', module: 'placements@2', final: 'final', ...(bronze ? { bronze: 'bronze' } : {}) },
  ];
  return d;
}

test('graph placements exclude ineligible historical finalists and bronze winners without renumbering', () => {
  const d = graph(true), results = [score('s1:match', 'a'), score('s2:match', 'c'), score('final:match', 'a'), score('bronze:match', 'b')];
  const semifinalLoserEligible = analyzeGraph(d, roster, results, { eligibleEntryIds: ['a', 'd'] });
  assert.equal(semifinalLoserEligible.state, 'completed');
  assert.deepEqual(semifinalLoserEligible.placements?.groups, [{ rank: 1, entryIds: ['a'] }, { rank: 4, entryIds: ['d'] }]);
  assert.deepEqual(new Set(semifinalLoserEligible.placements?.ineligibleEntryIds), new Set(['b', 'c']));
  assert.deepEqual(semifinalLoserEligible.resolvedFixtures.find(fixture => fixture.fixture.id === 'final:match')?.result, results[2]);
  const championWithdrawn = analyzeGraph(d, roster, results, { eligibleEntryIds: ['b', 'c', 'd'] });
  assert.equal(championWithdrawn.state, 'blocked');
  assert.equal(championWithdrawn.blockedCode, 'NO_ELIGIBLE_CHAMPION');
  assert.equal(championWithdrawn.placements?.championEntryId, undefined);
});

test('withdrawal of one semifinal loser does not promote quarterfinal losers', () => {
  const d = graph(false); d.registration.min_entries = 8; d.registration.max_entries = 8;
  const seed = (value: number) => ({ kind: 'seed' as const, seed: value });
  const winner = (node_id: string) => ({ kind: 'winner' as const, node_id });
  d.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    ...[0, 1, 2, 3].map(index => ({ id: `q${index + 1}`, module: 'match@1' as const, inputs: [seed(index * 2 + 1), seed(index * 2 + 2)] })),
    { id: 's1', module: 'match@1', inputs: [winner('q1'), winner('q2')] }, { id: 's2', module: 'match@1', inputs: [winner('q3'), winner('q4')] },
    { id: 'final', module: 'match@1', inputs: [winner('s1'), winner('s2')] }, { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => ({ id, playerIds: [`p-${id}`] }));
  const results = ['a', 'c', 'e', 'g'].map((id, index) => score(`q${index + 1}:match`, id));
  results.push(score('s1:match', 'a'), score('s2:match', 'e'), score('final:match', 'a'));
  const result = analyzeGraph(d, teams, results, { eligibleEntryIds: teams.map(team => team.id).filter(id => id !== 'c') });
  assert.deepEqual(result.placements?.groups, [
    { rank: 1, entryIds: ['a'] }, { rank: 2, entryIds: ['e'] }, { rank: 3, entryIds: ['g'] }, { rank: 5, entryIds: ['b', 'd', 'f', 'h'] },
  ]);
  assert.deepEqual(result.placements?.ineligibleEntryIds, ['c']);
});
