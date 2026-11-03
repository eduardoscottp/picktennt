import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TournamentDefinition } from '../../lib/tournament-builder/definition';
import type { Fixture, FixtureResult, TournamentEntry } from '../../lib/tournament-builder/types';
import { generateRoundRobin } from '../../lib/tournament-builder/modules/round-robin';
import { generateElimination, resolveBracket } from '../../lib/tournament-builder/modules/elimination';
import { computePlacements } from '../../lib/tournament-builder/modules/placements';
import { analyzeTournament } from '../../lib/tournament-builder/runtime';

const entries = (n: number): TournamentEntry[] => Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(65 + i), playerIds: [`p${i}a`, `p${i}b`] }));
const definition = (): TournamentDefinition => JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
const win = (fixture: Fixture, a: string, b: string, winner: string): FixtureResult => ({ fixtureId: fixture.id, outcome: 'played', accepted: true, winnerEntryId: winner, scoreA: winner === a ? 11 : 5, scoreB: winner === b ? 11 : 5 });

test('RR schedules every pair exactly once for all supported sizes/courts without collisions', () => {
  for (let n = 2; n <= 16; n++) for (const courts of [1, 2, 4, 8]) {
    const roster = entries(n), fixtures = generateRoundRobin(roster, courts);
    assert.equal(fixtures.length, n * (n - 1) / 2);
    const pairs = new Set<string>();
    for (const f of fixtures) {
      assert.equal(f.a.kind, 'entry'); assert.equal(f.b.kind, 'entry');
      if (f.a.kind !== 'entry' || f.b.kind !== 'entry') throw Error('RR must use entries');
      assert.notEqual(f.a.entryId, f.b.entryId);
      pairs.add([f.a.entryId, f.b.entryId].sort().join(':'));
      assert.ok(f.court >= 1 && f.court <= courts);
    }
    assert.equal(pairs.size, fixtures.length);
    for (const wave of new Set(fixtures.map(f => f.wave))) {
      const group = fixtures.filter(f => f.wave === wave);
      const players = group.flatMap(f => [f.a, f.b].flatMap(slot => slot.kind === 'entry' ? roster.find(e => e.id === slot.entryId)!.playerIds : []));
      assert.equal(new Set(players).size, players.length);
      assert.ok(group.length <= courts);
    }
    assert.deepEqual(generateRoundRobin(roster, courts), fixtures);
  }
  assert.equal(new Set(generateRoundRobin(entries(8), 4).map(f => f.wave)).size, 7);
  assert.throws(() => generateRoundRobin([{ id: 'A', playerIds: ['p'] }, { id: 'B', playerIds: ['p'] }], 1));
});
test('brackets protect seeds, bound courts, and create bronze only when requested', () => {
  for (const n of [2, 4, 8, 16]) for (const courts of [1, 2, 8]) {
    const roster = entries(n), fixtures = generateElimination(roster, courts, { seeding: 'ranked', bronze: false });
    assert.equal(fixtures.length, n - 1);
    assert.ok(fixtures.every(f => f.court <= courts));
    if (n >= 4) assert.equal(generateElimination(roster, courts, { seeding: 'draw', bronze: true }).length, n);
  }
  const eight = generateElimination(entries(8), 4, { seeding: 'ranked', bronze: false });
  assert.deepEqual(eight.filter(f => f.round === 1).flatMap(f => [f.a, f.b].map(s => s.kind === 'entry' ? s.entryId : null)), ['A', 'H', 'D', 'E', 'B', 'G', 'C', 'F']);
  const sixteen = generateElimination(entries(16), 8, { seeding: 'ranked', bronze: false });
  assert.deepEqual(sixteen.filter(f => f.round === 1).flatMap(f => [f.a, f.b].map(s => s.kind === 'entry' ? s.entryId : null)), ['A', 'P', 'H', 'I', 'D', 'M', 'E', 'L', 'B', 'O', 'G', 'J', 'C', 'N', 'F', 'K']);
  assert.throws(() => generateElimination(entries(2), 1, { seeding: 'draw', bronze: true }));
  assert.throws(() => generateElimination(entries(6), 1, { seeding: 'draw', bronze: false }));
  const one = generateElimination(entries(4), 1, { seeding: 'ranked', bronze: true });
  assert.ok(one.every(f => f.court === 1));
  assert.notEqual(one.find(f => f.bronze)!.wave, one.at(-2)!.wave);
});
test('advancement waits for accepted legal participant outcomes and propagates empty slots', () => {
  const fixtures = generateElimination(entries(4), 1, { seeding: 'ranked', bronze: false });
  const provisional = { ...win(fixtures[0], 'A', 'D', 'A'), accepted: false };
  assert.equal(resolveBracket(fixtures, [provisional]).fixtures.at(-1)!.state, 'waiting');
  assert.throws(() => resolveBracket(fixtures, [{ ...provisional, accepted: true, winnerEntryId: 'X' }]));
  assert.throws(() => resolveBracket(fixtures, [{ ...provisional, accepted: true, scoreA: 12, scoreB: 8 }]));
  assert.throws(() => resolveBracket(fixtures, [win(fixtures[2], 'A', 'B', 'A')]));
  const noContest: FixtureResult = { fixtureId: fixtures[0].id, accepted: true, outcome: 'no_contest' };
  const second = win(fixtures[1], 'B', 'C', 'B');
  const ready = resolveBracket(fixtures, [noContest, second]);
  assert.equal(ready.fixtures.at(-1)!.requiredOutcome, 'walkover');
  assert.equal(ready.fixtures.at(-1)!.entryA, null);
  const walkover: FixtureResult = { fixtureId: fixtures[2].id, accepted: true, outcome: 'walkover', winnerEntryId: 'B' };
  assert.equal(resolveBracket(fixtures, [noContest, second, walkover]).state, 'completed');
  assert.throws(() => resolveBracket(fixtures, [second, second]));
});
test('F01 accepted RR results lead to 31 fixtures and grouped playoff placements', () => {
  const d = definition(), roster = entries(8);
  const start = analyzeTournament(d, roster, []);
  assert.equal(start.fixtures.length, 28);
  const results = start.fixtures.map(f => {
    if (f.a.kind !== 'entry' || f.b.kind !== 'entry') throw Error('expected RR');
    return win(f, f.a.entryId, f.b.entryId, [f.a.entryId, f.b.entryId].sort()[0]);
  });
  const rrDone = analyzeTournament(d, roster, results);
  assert.equal(rrDone.fixtures.length, 31);
  assert.deepEqual(rrDone.qualifiers, ['A', 'B', 'C', 'D']);
  assert.deepEqual(rrDone.standings.map(r => r.wins), [7, 6, 5, 4, 3, 2, 1, 0]);
  const semis = rrDone.fixtures.filter(f => f.stageId === 'playoff' && f.round === 1);
  results.push(win(semis[0], 'A', 'D', 'A'), win(semis[1], 'B', 'C', 'B'));
  const beforeFinal = analyzeTournament(d, roster, results);
  results.push(win(beforeFinal.fixtures.at(-1)!, 'A', 'B', 'A'));
  const done = analyzeTournament(d, roster, results);
  assert.equal(done.state, 'completed');
  assert.deepEqual(done.placements?.groups, [{ rank: 1, entryIds: ['A'] }, { rank: 2, entryIds: ['B'] }, { rank: 3, entryIds: ['D', 'C'] }, { rank: 5, entryIds: ['E'] }, { rank: 6, entryIds: ['F'] }, { rank: 7, entryIds: ['G'] }, { rank: 8, entryIds: ['H'] }]);
  assert.deepEqual(analyzeTournament(d, roster, results), done);
});
test('direct draw must be supplied once and bronze results gate complete placements', () => {
  const d = definition(); d.registration.min_entries = 4; d.registration.max_entries = 4;
  d.nodes = [{ id: 'r', module: 'registration@1' }, { id: 'e', module: 'entries@1', from: 'r' }, { id: 'b', module: 'elimination@1', from: 'e', config: { seeding: 'draw', bronze: true } }, { id: 'p', module: 'placements@1', from: 'b' }];
  const roster = entries(4), options = { rosterRevision: 2, directDraw: { rosterRevision: 2, entryIds: ['B', 'D', 'A', 'C'] } };
  assert.equal(analyzeTournament(d, roster, []).blockedCode, 'DRAW_REQUIRED');
  assert.equal(analyzeTournament(d, roster, [], { ...options, rosterRevision: 3 }).blockedCode, 'DRAW_REQUIRED');
  const initial = analyzeTournament(d, roster, [], options);
  const matches = initial.fixtures;
  const results = [win(matches[0], 'B', 'C', 'B'), win(matches[1], 'D', 'A', 'A')];
  results.push(win(matches[2], 'B', 'A', 'B'));
  assert.equal(analyzeTournament(d, roster, results, options).state, 'waiting');
  results.push(win(matches[3], 'C', 'D', 'C'));
  const done = analyzeTournament(d, roster, results, options);
  assert.equal(done.state, 'completed');
  assert.deepEqual(done.placements?.groups, [{ rank: 1, entryIds: ['B'] }, { rank: 2, entryIds: ['A'] }, { rank: 3, entryIds: ['C'] }, { rank: 4, entryIds: ['D'] }]);
});
test('eight entry elimination groups quarterfinal losers at fifth without seed fallback', () => {
  const fixtures = generateElimination(entries(8), 4, { seeding: 'ranked', bronze: false });
  const results: FixtureResult[] = [];
  for (const f of fixtures) {
    const current = resolveBracket(fixtures, results).fixtures.find(x => x.fixture.id === f.id)!;
    results.push(win(f, current.entryA!, current.entryB!, current.entryA!));
  }
  const placed = computePlacements(resolveBracket(fixtures, results));
  assert.equal(placed.state, 'completed');
  assert.deepEqual(placed.groups?.map(g => [g.rank, g.entryIds.length]), [[1, 1], [2, 1], [3, 2], [5, 4]]);
});
test('exact RR ties block qualifiers until a current recorded whole-group draw is supplied', () => {
  const d = definition(); d.registration.min_entries = 3; d.registration.max_entries = 3;
  const q = d.nodes.find(n => n.module === 'qualify@1'); if (q?.module === 'qualify@1') q.config.count = 2;
  const roster = entries(3), fixtures = generateRoundRobin(roster, 4, 'rr');
  const results = fixtures.map(f => {
    if (f.a.kind !== 'entry' || f.b.kind !== 'entry') throw Error('RR');
    const pair = [f.a.entryId, f.b.entryId].sort().join('');
    const result = win(f, f.a.entryId, f.b.entryId, pair === 'AC' ? 'C' : pair[0]);
    result.scoreA = result.winnerEntryId === f.a.entryId ? 11 : 9;
    result.scoreB = result.winnerEntryId === f.b.entryId ? 11 : 9;
    return result;
  });
  assert.equal(analyzeTournament(d, roster, results).blockedCode, 'UNRESOLVED_TIE');
  assert.equal(analyzeTournament(d, roster, results, { inputRevision: 4, rankingDraws: [{ inputRevision: 3, entryIds: ['C', 'A', 'B'] }] }).blockedCode, 'UNRESOLVED_TIE');
  const drawn = analyzeTournament(d, roster, results, { inputRevision: 4, rankingDraws: [{ inputRevision: 4, entryIds: ['C', 'A', 'B'] }] });
  assert.deepEqual(drawn.qualifiers, ['C', 'A']);
});
test('withdrawal preserves historical accepted facts and prevents further participation', () => {
  const fixtures = generateElimination(entries(4), 1, { seeding: 'ranked', bronze: true });
  const results = [win(fixtures[0], 'A', 'D', 'A'), win(fixtures[1], 'B', 'C', 'B')];
  const resolved = resolveBracket(fixtures, results, ['B', 'C', 'D']);
  assert.equal(resolved.fixtures[0].winnerEntryId, 'A', 'Historical winner must survive current eligibility changes.');
  assert.equal(resolved.fixtures[2].entryA, null);
  assert.equal(resolved.fixtures[2].requiredOutcome, 'walkover');
  const noChampion = generateElimination(entries(2), 1, { seeding: 'draw', bronze: false });
  assert.equal(computePlacements(resolveBracket(noChampion, [{ fixtureId: noChampion[0].id, outcome: 'no_contest', accepted: true }], [])).blockedCode, 'NO_ELIGIBLE_CHAMPION');
});
test('after playoff start pinned qualifiers prevent backfill; before start next eligible rank replaces', () => {
  const d = definition(), roster = entries(8), rr = generateRoundRobin(roster, 4, 'rr');
  const results = rr.map(f => {
    if (f.a.kind !== 'entry' || f.b.kind !== 'entry') throw Error('RR');
    return win(f, f.a.entryId, f.b.entryId, [f.a.entryId, f.b.entryId].sort()[0]);
  });
  const eligibleEntryIds = ['A', 'B', 'C', 'E', 'F', 'G', 'H'];
  assert.deepEqual(analyzeTournament(d, roster, results, { eligibleEntryIds }).qualifiers, ['A', 'B', 'C', 'E']);
  const started = analyzeTournament(d, roster, results, { eligibleEntryIds, playoffsStarted: true, lockedQualifierIds: ['A', 'B', 'C', 'D'] });
  assert.deepEqual(started.qualifiers, ['A', 'B', 'C', 'D']);
  assert.equal(started.bracket?.fixtures[0].requiredOutcome, 'walkover');
});
test('RR rejects illegal accepted scores and foreign results even while incomplete', () => {
  const d = definition(), roster = entries(8), first = generateRoundRobin(roster, 4, 'rr')[0];
  assert.throws(() => analyzeTournament(d, roster, [{ fixtureId: 'other-event:match', accepted: true, outcome: 'no_contest' }]));
  if (first.a.kind !== 'entry' || first.b.kind !== 'entry') throw Error('RR');
  const a = first.a.entryId, b = first.b.entryId;
  assert.throws(() => analyzeTournament(d, roster, [{ ...win(first, a, b, a), scoreA: 12, scoreB: 8 }]));
});

