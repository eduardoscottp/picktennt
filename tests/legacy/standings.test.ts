import assert from 'node:assert/strict';
import test from 'node:test';
import type { Match } from '../../types/database';
import { isLegacyMatchComplete, legacyWinnerSide } from '../../lib/tournament/match-result';
import { computeStandings, computeIndividualStandingsFromTeams, computeBracketFinishPositions, rankExitedLast } from '../../lib/tournament/standings';

function match(overrides: Partial<Match> = {}): Match {
  return { id: 'm', round_id: 'rr', team_a_id: 'a', team_b_id: 'b', player_a1_id: null, player_a2_id: null,
    player_b1_id: null, player_b2_id: null, score_a: null, score_b: null, status: 'scheduled',
    bracket_next_loser_match_id: null, ...overrides } as Match;
}

test('completed walkover does not require scores; live/provisional/disputed results remain pending', () => {
  assert.equal(isLegacyMatchComplete(match({ status: 'walkover' })), true);
  assert.equal(isLegacyMatchComplete(match({ status: 'validated' })), true);
  for (const status of ['scheduled', 'in_progress', 'score_entered', 'disputed'] as const) {
    assert.equal(isLegacyMatchComplete(match({ status })), false);
  }
});

test('explicit scoreless walkover records only win/loss and never invented points', () => {
  const rows = computeStandings([match({ status: 'walkover', legacy_winner_side: 'b', outcome_kind: 'walkover' })], 'team');
  assert.deepEqual(rows, [
    { id: 'b', wins: 1, losses: 0, pointsFor: 0, pointsAgainst: 0, pointsForInLosses: 0, rank: 1 },
    { id: 'a', wins: 0, losses: 1, pointsFor: 0, pointsAgainst: 0, pointsForInLosses: 0, rank: 2 },
  ]);
  assert.equal(legacyWinnerSide(match({ status: 'walkover', winner_team_id: 'b' })), 'b');
});

test('missing historical winner and no-contest never invent winners or draw points', () => {
  for (const result of [match({ status: 'walkover' }), match({ status: 'walkover', outcome_kind: 'no_contest' }),
    match({ status: 'validated', outcome_kind: 'retirement', score_a: 9, score_b: 6 })]) {
    assert.equal(legacyWinnerSide(result), null);
    assert.deepEqual(computeStandings([result], 'team'), []);
  }
});

test('retirement waits for validation, then uses recorded outcome and adjusted score', () => {
  const retirement = match({ status: 'score_entered', outcome_kind: 'retirement', legacy_winner_side: 'b', score_a: 6, score_b: 11 });
  assert.deepEqual(computeStandings([retirement], 'team'), []);
  const validated = { ...retirement, status: 'validated' as const };
  const rows = computeStandings([validated], 'team');
  assert.equal(rows[0].id, 'b');
  assert.equal(rows[0].pointsFor, 11);
  assert.equal(rows[1].pointsForInLosses, 6);
  // Result identity remains authoritative even for imported historical retirement data.
  assert.equal(legacyWinnerSide({ ...validated, score_a: 9, score_b: 6 }), 'b');
});

test('mid-RR withdrawal nullifies both prior played result and future walkover for opponents', () => {
  const played = match({ status: 'validated', score_a: 11, score_b: 2 });
  const walkover = match({ status: 'walkover', legacy_winner_side: 'b' });
  assert.deepEqual(computeStandings([played, walkover], 'team', new Set(['a'])), []);
  const ranked = rankExitedLast(computeStandings([played], 'team'), new Set(['a']));
  assert.equal(ranked[0].id, 'b');
  assert.equal(ranked[1].id, 'a');
  assert.equal(ranked[1].wins, 1, 'post-RR withdrawal retains played stats but loses qualifying rank');
  assert.equal(rankExitedLast([], new Set(['a']))[0].wins, 0, 'nullified withdrawn entities remain visible with zero stats');
});

test('replacement receives only own games; historical snapshots override current roster per side', () => {
  const roster = new Map([['a', ['new', 'partner']], ['b', ['opponent1', 'opponent2']]]);
  const oldGame = match({ status: 'validated', score_a: 11, score_b: 4, player_a1_id: 'old', player_a2_id: 'partner' });
  const newGame = match({ status: 'validated', score_a: 3, score_b: 11, player_a1_id: 'new', player_a2_id: 'partner' });
  const byId = new Map(computeIndividualStandingsFromTeams([oldGame, newGame], roster).map(row => [row.id, row]));
  assert.equal(byId.get('old')!.wins, 1);
  assert.equal(byId.get('old')!.pointsFor, 11);
  assert.equal(byId.get('new')!.wins, 0);
  assert.equal(byId.get('new')!.losses, 1);
  assert.equal(byId.get('new')!.pointsFor, 3);
  assert.equal(byId.get('opponent1')!.pointsFor, 15, 'older side without snapshots retains fallback');
  assert.deepEqual(computeIndividualStandingsFromTeams([oldGame], roster, new Set(['old'])), []);
  assert.equal(computeStandings([oldGame, newGame], 'team').find(row => row.id === 'a')!.pointsFor, 14);
});

test('mixed walkovers credit each actual player, and gold/bronze winners resolve without scores', () => {
  const result = match({ status: 'walkover', legacy_winner_side: 'b', player_a1_id: 'a1', player_a2_id: 'a2', player_b1_id: 'b1', player_b2_id: 'b2' });
  const rows = computeStandings([result], 'player');
  assert.equal(rows.filter(row => row.wins === 1).length, 2);
  assert.equal(rows.filter(row => row.losses === 1).length, 2);
  assert.ok(rows.every(row => row.pointsFor === 0));
  const rounds = [{ id: 'gold', round_type: 'finals_gold' as const, round_number: 3 }];
  const positions = computeBracketFinishPositions([{ ...result, round_id: 'gold' }], rounds, 'team', []);
  assert.equal(positions.get('b'), 1);
  assert.equal(positions.get('a'), 2);
  assert.equal(computeBracketFinishPositions([{ ...result, round_id: 'gold', legacy_winner_side: null }], rounds, 'team', []).size, 0);
});

 test('confirmed administrative0–11 losses count points and losses while withdrawing team ranks last', () => {
  const allLosses = [match({ status: 'walkover', outcome_kind: 'walkover', legacy_winner_side: 'b', score_a: 0, score_b: 11 }),
    match({ id: 'second', team_a_id: 'c', team_b_id: 'a', status: 'walkover', outcome_kind: 'walkover', legacy_winner_side: 'a', score_a: 11, score_b: 0 })];
  const rows = rankExitedLast(computeStandings(allLosses, 'team'), new Set(['a']));
  assert.equal(rows[2].id, 'a');
  assert.equal(rows[2].losses, 2);
  assert.equal(rows[2].wins, 0);
  assert.equal(rows[2].pointsAgainst, 22);
  assert.ok(rows.slice(0, 2).every(row => row.wins === 1 && row.pointsFor === 11));
 });
