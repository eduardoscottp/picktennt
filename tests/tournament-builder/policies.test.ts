import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLegalScore, computeStandings } from '../../lib/tournament-builder/policies';

test('a game ends at the first winning score, including deuce', () => {
  const policy = { target: 11 as const, win_by: 2 as const };
  for (const [a, b] of [[11, 0], [11, 9], [12, 10], [10, 12], [30, 28]]) {
    assert.equal(isLegalScore(a, b, policy), true, `${a}-${b}`);
  }
  for (const [a, b] of [[11, 10], [12, 8], [10, 10], [-1, 11], [11.5, 9], [Infinity, 9]]) {
    assert.equal(isLegalScore(a, b, policy), false, `${a}-${b}`);
  }
  assert.equal(isLegalScore(11, 10, { target: 11, win_by: 1 }), true);
  assert.equal(isLegalScore(12, 11, { target: 11, win_by: 1 }), false);
});

test('standings include idle entries; only accepted results count', () => {
  const result = computeStandings(['A', 'B', 'C'], [
    { a: 'A', b: 'B', scoreA: 11, scoreB: 9, outcome: 'played', accepted: true },
    { a: 'C', b: 'A', scoreA: 11, scoreB: 0, outcome: 'played', accepted: false },
  ], ['wins_desc', 'differential_desc', 'points_for_desc']);
  assert.deepEqual(result.rows.map(r => [r.entryId, r.wins, r.losses, r.pointsFor]), [['A', 1, 0, 11], ['C', 0, 0, 0], ['B', 0, 1, 9]]);
});

test('walkovers count wins, not fictional points; no contests count nothing', () => {
  const result = computeStandings(['A', 'B', 'C'], [
    { a: 'A', b: 'B', outcome: 'walkover', winner: 'B', accepted: true },
    { a: 'B', b: 'C', outcome: 'no_contest', accepted: true },
  ], ['wins_desc', 'points_for_desc']);
  assert.equal(result.rows[0].entryId, 'B');
  assert.equal(result.rows[0].wins, 1);
  assert.ok(result.rows.every(r => r.pointsFor === 0 && r.pointsAgainst === 0));
});

test('exact ties remain unresolved until a complete recorded draw is provided', () => {
  const games = [
    { a: 'A', b: 'B', scoreA: 11, scoreB: 9, outcome: 'played' as const, accepted: true },
    { a: 'B', b: 'C', scoreA: 11, scoreB: 9, outcome: 'played' as const, accepted: true },
    { a: 'C', b: 'A', scoreA: 11, scoreB: 9, outcome: 'played' as const, accepted: true },
  ];
  const order = ['wins_desc', 'differential_desc', 'points_for_desc'] as const;
  assert.deepEqual(computeStandings(['A', 'B', 'C'], games, order).ties, [['A', 'B', 'C']]);
  const resolved = computeStandings(['A', 'B', 'C'], games, order, [['C', 'A', 'B']]);
  assert.deepEqual(resolved.rows.map(r => r.entryId), ['C', 'A', 'B']);
  assert.deepEqual(resolved.ties, []);
  assert.equal(computeStandings(['A', 'B', 'C'], games, order, [['A', 'B']]).ties.length, 1);
});

test('excluded entries nullify every related match for an incomplete round robin', () => {
  const result = computeStandings(['A', 'B', 'C'], [
    { a: 'A', b: 'B', scoreA: 11, scoreB: 0, outcome: 'played', accepted: true },
  ], ['wins_desc'], [], ['B']);
  assert.deepEqual(result.rows.map(r => r.entryId), ['A', 'C']);
  assert.ok(result.rows.every(r => r.wins === 0 && r.pointsFor === 0));
});
