import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { assertWebWithdrawalPolicy } from '../../lib/tournament-builder/web-withdrawal-policy';

const snapshot = (state: string): CommandSnapshot => ({ event: { id: 'event', modular_state: state }, definitions: [], teams: [], team_members: [], tournament_players: [], rounds: [], stages: [], matches: [], standings: [] });

test('public web actions allow prestart removal and require the new team policy after starting', () => {
  for (const state of ['registration_open', 'registration_closed', 'ready']) assert.doesNotThrow(() => assertWebWithdrawalPolicy('withdrawEntry', {}, snapshot(state)));
  for (const state of ['active', 'completed']) {
    assert.throws(() => assertWebWithdrawalPolicy('withdrawEntry', {}, snapshot(state)), { code: 'INVALID_COMMAND' });
    assert.throws(() => assertWebWithdrawalPolicy('withdrawPlayer', { policy: 'all_matches_0_11' }, snapshot(state)), { code: 'INVALID_COMMAND' });
    assert.doesNotThrow(() => assertWebWithdrawalPolicy('withdrawEntry', { policy: 'all_matches_0_11' }, snapshot(state)));
  }
  const staleState = snapshot('ready'); staleState.matches.push({ id: 'match', status: 'score_entered', score_a: 11, score_b: 2 });
  assert.throws(() => assertWebWithdrawalPolicy('withdrawEntry', {}, staleState), { code: 'INVALID_COMMAND' });
});

test('removed per-match retirement and walkover modes cannot bypass the web interface', () => {
  for (const command of ['attestScore', 'adjudicateDispute', 'commitCorrection']) {
    for (const outcome_kind of ['walkover', 'retirement']) assert.throws(() => assertWebWithdrawalPolicy(command, { outcome_kind }), { code: 'INVALID_COMMAND' });
    assert.doesNotThrow(() => assertWebWithdrawalPolicy(command, { outcome_kind: 'played' }));
  }
});
