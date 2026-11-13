import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { overallPositions } from '../../lib/tournament-builder/overall-positions';

function event(graph = false): CommandSnapshot {
  const definition = graph
    ? { schema_version: '2.0', nodes: [{ id: 'F', module: 'match@1' }, { id: 'B', module: 'match@1' }, { id: 'places', module: 'placements@2', final: 'F', bronze: 'B' }] }
    : { schema_version: '1.0', nodes: [] };
  return {
    event: { id: 'event', definition_id: 'definition', modular_state: 'active' },
    definitions: [{ id: 'definition', definition }],
    teams: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, entry_state: 'approved' })),
    team_members: [], tournament_players: [], standings: [],
    stages: [{ id: 'placement', node_id: 'places', module_id: 'placements', state: 'waiting', output: {} },
      { id: 'final-stage', node_id: 'F', module_id: 'match' }, { id: 'bronze-stage', node_id: 'B', module_id: 'match' }],
    rounds: [{ id: 'gold', round_type: 'finals_gold' }, { id: 'bronze', round_type: 'finals_bronze' }],
    matches: [
      { id: 'final', stage_id: 'final-stage', logical_key: 'F:match', round_id: 'gold', status: 'scheduled', team_a_id: 'a', team_b_id: 'd', is_current: true },
      { id: 'third', stage_id: 'bronze-stage', logical_key: 'B:match', round_id: 'bronze', status: 'scheduled', team_a_id: 'b', team_b_id: 'c', is_current: true },
    ],
  };
}

for (const graph of [false, true]) test(`${graph ? 'graph' : 'v1'} displays only confirmed progress and validated placement matches`, () => {
  const snapshot = event(graph);
  assert.deepEqual(overallPositions(snapshot).map(group => [group.rankLabel, group.entryIds, group.provisional]), [
    ['1–2', ['a', 'd'], true], ['3–4', ['b', 'c'], true],
  ]);
  // A score awaiting validation cannot award the championship.
  Object.assign(snapshot.matches[0], { status: 'score_entered', outcome_kind: 'played', winner_team_id: 'd' });
  assert.equal(overallPositions(snapshot)[0].rankLabel, '1–2');
  // The lower-seeded entrant wins the final regardless of its round-robin record.
  snapshot.matches[0].status = 'validated';
  assert.deepEqual(overallPositions(snapshot).map(group => [group.rankLabel, group.entryIds]), [
    ['1', ['d']], ['2', ['a']], ['3–4', ['b', 'c']],
  ]);
  Object.assign(snapshot.matches[1], { status: 'validated', outcome_kind: 'played', winner_team_id: 'c' });
  assert.deepEqual(overallPositions(snapshot).map(group => [group.rankLabel, group.entryIds]), [
    ['1', ['d']], ['2', ['a']], ['3', ['c']], ['4', ['b']],
  ]);
  snapshot.matches[0].outcome_kind = 'no_contest';
  assert.equal(overallPositions(snapshot)[0].rankLabel, '1–2');
});

test('official finished placements preserve shared ranks and never change pool standings', () => {
  const snapshot = event(true);
  snapshot.event!.modular_state = 'completed';
  snapshot.standings = [{ id: 'rank', team_id: 'd', rank: 4, wins: 2 }, { id: 'rank2', team_id: 'a', rank: 1, wins: 6 }];
  snapshot.stages[0].state = 'completed';
  snapshot.stages[0].output = { state: 'completed', championEntryId: 'd', groups: [
    { rank: 1, entryIds: ['d'] }, { rank: 2, entryIds: ['a'] }, { rank: 3, entryIds: ['b', 'c'] }, { rank: 5, entryIds: ['e'] },
  ] };
  const before = structuredClone(snapshot.standings);
  assert.deepEqual(overallPositions(snapshot).map(group => [group.rankLabel, group.entryIds]), [
    ['1', ['d']], ['2', ['a']], ['3', ['b', 'c']], ['5', ['e']],
  ]);
  assert.deepEqual(snapshot.standings, before);
  snapshot.event!.results_under_review = true;
  assert.deepEqual(overallPositions(snapshot), []);
});

test('unknown, void, duplicate, ineligible and unfinished results cannot invent a champion', () => {
  const snapshot = event();
  snapshot.matches[0].team_b_id = null;
  snapshot.matches[1].is_current = false;
  assert.deepEqual(overallPositions(snapshot).map(group => [group.rankLabel, group.entryIds]), [['1–2', ['a']]]);
  snapshot.matches[0].team_a_id = null;
  assert.deepEqual(overallPositions(snapshot), []);
  snapshot.matches[0].team_a_id = 'a'; snapshot.matches[0].team_b_id = 'd';
  snapshot.matches[1].is_current = true; snapshot.matches[1].team_a_id = 'a';
  assert.deepEqual(overallPositions(snapshot), []);
  snapshot.matches[1].team_a_id = 'b';
  snapshot.teams.find(team => team.id === 'd')!.entry_state = 'withdrawn';
  snapshot.disciplinary_excluded_team_ids = ['c'];
  assert.deepEqual(overallPositions(snapshot).flatMap(group => group.entryIds).sort(), ['a', 'b']);
  snapshot.event!.modular_state = 'completed';
  assert.deepEqual(overallPositions(snapshot), []);
});

test('a finished round robin without further rounds uses the published final placements', () => {
  const snapshot = event();
  snapshot.matches = []; snapshot.rounds = [];
  assert.deepEqual(overallPositions(snapshot), []);
  snapshot.event!.modular_state = 'completed';
  snapshot.stages[0].state = 'completed';
  snapshot.stages[0].output = { state: 'completed', championEntryId: 'a', groups: [{ rank: 1, entryIds: ['a'] }, { rank: 2, entryIds: ['b'] }] };
  assert.deepEqual(overallPositions(snapshot).map(group => [group.rankLabel, group.entryIds]), [['1', ['a']], ['2', ['b']]]);
});

test('contradictory published placements never show multiple champions or duplicate entries', () => {
  const snapshot = event();
  snapshot.event!.modular_state = 'completed'; snapshot.stages[0].state = 'completed';
  snapshot.stages[0].output = { state: 'completed', championEntryId: 'a', groups: [{ rank: 1, entryIds: ['a'] }, { rank: 1, entryIds: ['b'] }] };
  assert.deepEqual(overallPositions(snapshot), []);
  snapshot.stages[0].output = { state: 'completed', championEntryId: 'a', groups: [{ rank: 1, entryIds: ['a'] }, { rank: 2, entryIds: ['a'] }] };
  assert.deepEqual(overallPositions(snapshot), []);
  snapshot.stages[0].output = { state: 'completed', championEntryId: 'b', groups: [{ rank: 1, entryIds: ['a'] }, { rank: 2, entryIds: ['b'] }] };
  assert.deepEqual(overallPositions(snapshot), []);
});
