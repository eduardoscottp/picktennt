import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import { generateRoundRobin } from '../../lib/tournament-builder/modules/round-robin';
import { scheduleFairly, summarizeScheduleFairness } from '../../lib/tournament-builder/fair-scheduling';
import type { FixtureResult } from '../../lib/tournament-builder/types';
import { planCommand, type CommandPlan, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';

const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, playerIds: [`p${i + 1}`] }));
function definition(): GraphDefinition {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  d.schema_version = '2.0';
  d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
  d.registration.min_entries = 8; d.registration.max_entries = 8; d.event.courts = 2;
  d.nodes = [
    { id: 'reg', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'reg' },
    ...['a', 'b'].map((id, group) => ({ id, module: 'round_robin@2', inputs: Array.from({ length: 4 }, (_, i) => ({ kind: 'seed', seed: group * 4 + i + 1 })) })),
    { id: 'final', module: 'match@1', inputs: ['a', 'b'].map(node_id => ({ kind: 'rank', node_id, rank: 1 })) },
    { id: 'places', module: 'placements@2', final: 'final' },
  ];
  return d;
}

test('independent pools share early court time instead of finishing the first pool first', () => {
  const fixtures = analyzeGraph(definition(), roster(8), []).fixtures;
  for (const stage of ['a', 'b']) {
    const waves = fixtures.filter(f => f.stageId === stage).map(f => f.wave);
    assert.ok(Math.min(...waves) <= 2);
    assert.ok(Math.max(...waves) >= 5);
  }
});

test('six teams on two courts reduce the original split-circle longest wait from two slots to one', () => {
  const fixtures = generateRoundRobin(roster(6), 2);
  const longestWait = (old: boolean) => Math.max(...roster(6).map(entry => {
    const slots = fixtures.filter(f => [f.a, f.b].some(s => s.kind === 'entry' && s.entryId === entry.id)).map(f => old ? (f.round - 1) * 2 + Math.floor((Number(f.id.split(':m')[1]) - 1) / 2) + 1 : f.wave).sort((a, b) => a - b);
    return Math.max(...slots.slice(1).map((slot, i) => slot - slots[i] - 1));
  }));
  assert.equal(longestWait(true), 2);
  assert.equal(longestWait(false), 1);
  assert.equal(Math.max(...fixtures.map(f => f.wave)), 8);
});

test('scores leave fixture schedule stable and all feeder matches precede their dependents', () => {
  const d = definition(), teams = roster(8), initial = analyzeGraph(d, teams, []);
  const results: FixtureResult[] = [];
  const schedule = (analysis: typeof initial) => analysis.fixtures.map(({ id, wave, court, round }) => ({ id, wave, court, round }));
  for (const f of initial.resolvedFixtures.filter(f => f.fixture.stageId !== 'final')) {
    const aWins = Number(f.entryA!.slice(1)) < Number(f.entryB!.slice(1));
    results.push({ fixtureId: f.fixture.id, accepted: true, outcome: 'played', winnerEntryId: aWins ? f.entryA : f.entryB, scoreA: aWins ? 11 : 0, scoreB: aWins ? 0 : 11 });
    assert.deepEqual(schedule(analyzeGraph(d, teams, results)), schedule(initial));
  }
  assert.ok(initial.fixtures.find(f => f.stageId === 'final')!.wave > Math.max(...initial.fixtures.filter(f => f.stageId !== 'final').map(f => f.wave)));
});

test('odd rosters retain each opponent once, original circle IDs, and conflict-free slots', () => {
  for (const n of [3, 5, 7, 9]) {
    const fixtures = generateRoundRobin(roster(n), 2);
    assert.equal(fixtures.length, n * (n - 1) / 2);
    const pairs = new Set(fixtures.map(f => [f.a, f.b].map(s => s.kind === 'entry' ? s.entryId : '').sort().join(':')));
    assert.equal(pairs.size, fixtures.length);
    for (const wave of new Set(fixtures.map(f => f.wave))) {
      const playing = fixtures.filter(f => f.wave === wave);
      assert.ok(playing.length <= 2);
      const ids = playing.flatMap(f => [f.a, f.b].map(s => s.kind === 'entry' ? s.entryId : ''));
      assert.equal(new Set(ids).size, ids.length);
    }
    assert.deepEqual(generateRoundRobin(roster(n), 2), fixtures);
  }
  const six = generateRoundRobin(roster(6), 2);
  assert.deepEqual(six.slice(0, 3).map(f => [f.id, f.round, f.a, f.b]), [
    ['rr:r1:m1', 1, { kind: 'entry', entryId: 'e1' }, { kind: 'entry', entryId: 'e6' }],
    ['rr:r1:m2', 1, { kind: 'entry', entryId: 'e2' }, { kind: 'entry', entryId: 'e5' }],
    ['rr:r1:m3', 1, { kind: 'entry', entryId: 'e3' }, { kind: 'entry', entryId: 'e4' }],
  ]);
});

test('shared possible players cannot overlap and dependencies require an earlier slot', () => {
  const fixtures = generateRoundRobin(roster(3), 2);
  const blocks = fixtures.map((fixture, i) => ({ id: String(i), fixtures: [fixture], dependencies: i === 2 ? ['0', '1'] : [], players: new Map([[fixture.id, ['possible-player']]]) }));
  scheduleFairly(blocks, 2, 1);
  assert.equal(new Set(fixtures.map(f => f.wave)).size, 3);
  assert.ok(fixtures[2].wave > Math.max(fixtures[0].wave, fixtures[1].wave));
});

test('fairness counts concrete games and only idle slots between first and last play', () => {
  const teams = roster(3), fixtures = generateRoundRobin(teams, 2);
  const resolved = fixtures.map((fixture, i) => ({ fixture: { ...fixture, wave: [2, 3, 6][i] }, state: 'ready' as const, entryA: 'e1', entryB: 'e2' }));
  const summary = summarizeScheduleFairness(teams, [...resolved, { ...resolved[0], entryB: undefined }]);
  assert.deepEqual(summary[0], { entryId: 'e1', games: 3, idleSlots: 2, longestWait: 2, longestConsecutivePlay: 2 });
  assert.deepEqual(summary[2], { entryId: 'e3', games: 0, idleSlots: 0, longestWait: 0, longestConsecutivePlay: 0 });
});

test('accepting results preserves the stored schedule of an already-running graph event', () => {
  const id = () => crypto.randomUUID();
  const actor = { id: id(), clientId: 'web', role: 'owner' as const };
  const context = { now: '2026-10-28T16:00:00Z', id, draw: (ids: readonly string[]) => [...ids] };
  const s: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  function apply(plan: CommandPlan) {
    s.event = { id: s.event?.id ?? id(), created_by: actor.id, roster_revision: 0, result_version: 0, ...s.event, ...plan.effects.event, revision: Number(s.event?.revision ?? 0) + 1 };
    if (plan.effects.definition) {
      const old = s.definitions.find(row => row.id === plan.effects.definition!.id);
      if (old) Object.assign(old, plan.effects.definition); else s.definitions.push(plan.effects.definition);
    }
    for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) for (const patch of plan.effects[table] ?? []) {
      const old = s[table].find(row => row.id === patch.id);
      if (old) Object.assign(old, patch); else s[table].push(patch);
    }
  }
  const execute = (command: string, data = {}) => apply(planCommand(s, actor, command, data, context));
  const d = definition(), preview = previewDefinition(d, 1);
  execute('createDraft', { definition: d });
  execute('publishTournament', { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes });
  for (let i = 0; i < 8; i++) execute('addRegisteredEntry', { definition_id: s.event!.definition_id, player_ids: [id()], entry_name: `Team ${i + 1}`, reason: 'Organizer enrollment' });
  execute('closeRegistration');
  execute('lockRoster', { reviewed_roster_revision: s.event!.roster_revision });
  execute('startTournament');
  // A previously saved plan or administrator assignment differs from the new planner.
  s.rounds.forEach(round => { round.logical_wave = Number(round.logical_wave) + 20; });
  s.matches.forEach(match => { match.court_number = 3 - Number(match.court_number); });
  const schedule = () => s.matches.map(m => ({ id: m.id, round: m.round_id, court: m.court_number }));
  const before = schedule(), rounds = structuredClone(s.rounds);
  const poolMatches = s.matches.filter(m => m.team_a_id && m.team_b_id);
  execute('startMatch', { match_id: poolMatches[0].id });
  for (const match of poolMatches) {
    const aWins = Number(s.teams.find(t => t.id === match.team_a_id)!.seed) < Number(s.teams.find(t => t.id === match.team_b_id)!.seed);
    execute('attestScore', { match_id: match.id, score_a: aWins ? 11 : 0, score_b: aWins ? 0 : 11, reason: 'Verified result' });
    assert.deepEqual(schedule(), before);
    assert.deepEqual(s.rounds, rounds, 'replay must not create unused replacement rounds');
  }
  assert.ok(s.matches.find(m => m.logical_key === 'final:match')!.team_a_id);
  assert.ok(s.matches.find(m => m.logical_key === 'final:match')!.team_b_id);
});
