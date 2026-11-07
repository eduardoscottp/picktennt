import assert from 'node:assert/strict';
import test from 'node:test';
import { planPlayerReplacement, previewPlayerReplacement } from '../../lib/tournament-builder/player-replacement';
import { confirmationQuestion } from '../../lib/tournament-builder/mcp-confirmation';
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';

const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005'];
const actor = { id: ids[0], clientId: 'web', role: 'owner' as const };
function snapshot(): CommandSnapshot {
  return { event: { id: ids[4], created_by: ids[0], modular_state: 'active', revision: 4, definition_id: 'definition' }, definitions: [{ id: 'definition', definition: { registration: { entry_type: 'singles' } } }], teams: [{ id: ids[1], entry_state: 'approved' }], team_members: [{ id: ids[4], team_id: ids[1], user_id: ids[2], membership_status: 'active' }], tournament_players: [{ id: ids[2], user_id: ids[2], status: 'approved' }], stages: [], rounds: [], standings: [], matches: [{ id: 'past', team_a_id: ids[1], status: 'validated', player_a1_id: ids[2] }, { id: 'future', team_b_id: ids[1], status: 'scheduled' }] };
}
const input = { team_id: ids[1], old_user_id: ids[2], new_user_id: ids[3], reason: 'Player replacement' };
test('replacement preview separates played and future matches and binds the revision', () => {
  const s = snapshot(), preview = previewPlayerReplacement(s, actor, input);
  assert.deepEqual(preview.preserved_match_ids, ['past']);
  assert.deepEqual(preview.future_match_ids, ['future']);
  assert.deepEqual(preview.unknown_history_match_ids, []);
  assert.notEqual(preview.preview_hash, previewPlayerReplacement({ ...s, event: { ...s.event!, revision: 5 } }, actor, input).preview_hash);
  const uncertain = snapshot(); delete uncertain.matches[0].player_a1_id;
  const uncertainPreview = previewPlayerReplacement(uncertain, actor, input);
  assert.deepEqual(uncertainPreview.unknown_history_match_ids, ['past']);
  assert.equal(confirmationQuestion('admin_preview_player_replacement', uncertainPreview), undefined);
  assert.deepEqual((publicMcpResult('admin_preview_player_replacement', uncertainPreview) as { unknown_history_match_ids: string[] }).unknown_history_match_ids, ['past']);
  const doubles = snapshot();
  doubles.event!.definition_id = 'definition';
  doubles.definitions = [{ id: 'definition', definition: { registration: { entry_type: 'fixed_doubles' } } }];
  assert.deepEqual(previewPlayerReplacement(doubles, actor, input).unknown_history_match_ids, ['past']);
});
test('replacement plan keeps the team and past matches while changing the roster', () => {
  const s = snapshot(), preview = previewPlayerReplacement(s, actor, input), context = { id: () => ids[3], now: '2026-11-05T12:00:00Z' };
  const plan = planPlayerReplacement(s, actor, { ...input, preview_hash: preview.preview_hash }, context);
  assert.equal(plan.effects.teams?.[0].id, ids[1]);
  assert.equal(plan.effects.matches, undefined);
  assert.equal(plan.effects.team_members?.find(member => member.user_id === ids[3])?.consented_at, null);
  assert.equal(plan.effects.tournament_players?.find(player => player.user_id === ids[3])?.status, 'approved');
  assert.throws(() => planPlayerReplacement(s, actor, { ...input, preview_hash: 'stale' }, context), { code: 'STALE_PREVIEW' });
  const uncertain = snapshot(); delete uncertain.matches[0].player_a1_id;
  assert.throws(() => planPlayerReplacement(uncertain, actor, { ...input, preview_hash: previewPlayerReplacement(uncertain, actor, input).preview_hash }, context), { code: 'INVALID_STATE' });
  const frozen = snapshot(); frozen.matches[1].player_b1_id = ids[0];
  const frozenPreview = previewPlayerReplacement(frozen, actor, input);
  assert.deepEqual(frozenPreview.blocked_future_match_ids, ['future']);
  assert.throws(() => planPlayerReplacement(frozen, actor, { ...input, preview_hash: frozenPreview.preview_hash }, context), { code: 'INVALID_STATE' });
  const fixed = snapshot(); fixed.matches[1].player_b1_id = ids[2];
  const fixedPreview = previewPlayerReplacement(fixed, actor, input);
  assert.deepEqual(fixedPreview.blocked_future_match_ids, []);
  assert.deepEqual(planPlayerReplacement(fixed, actor, { ...input, preview_hash: fixedPreview.preview_hash }, context).effects.matches, [{ id: 'future', player_b1_id: ids[3] }]);
});
test('replacement preview rejects outsiders, duplicate players and invalid input', () => {
  const s = snapshot();
  assert.throws(() => previewPlayerReplacement(s, { id: ids[3], clientId: 'web' }, input), { code: 'FORBIDDEN' });
  assert.throws(() => previewPlayerReplacement(s, actor, { ...input, new_user_id: ids[2] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => previewPlayerReplacement({ ...s, team_members: [...s.team_members, { id: ids[3], team_id: ids[1], user_id: ids[3], membership_status: 'active' }] }, actor, input), { code: 'DUPLICATE_ENTRY' });
  assert.throws(() => previewPlayerReplacement({ ...s, team_members: [...s.team_members, { id: ids[3], team_id: ids[4], user_id: ids[2], membership_status: 'pending' }] }, actor, input), { code: 'INVALID_STATE' });
});
