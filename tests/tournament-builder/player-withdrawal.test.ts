import assert from 'node:assert/strict';
import test from 'node:test';
import { planPlayerWithdrawal, previewPlayerWithdrawal } from '../../lib/tournament-builder/player-withdrawal';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { confirmationQuestion } from '../../lib/tournament-builder/mcp-confirmation';
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';

const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
const actor = { id: ids[0], clientId: 'web', role: 'owner' as const }, data = { team_id: ids[1], user_id: ids[2], reason: 'Player withdrew' };
function snapshot(): CommandSnapshot {
 return { event: { id: ids[3], created_by: ids[0], modular_state: 'active', revision: 4, roster_revision: 2, definition_id: 'def' }, definitions: [{ id: 'def', definition: { registration: { entry_type: 'singles' } } }], teams: [{ id: ids[1], entry_state: 'approved' }], team_members: [{ id: ids[3], team_id: ids[1], user_id: ids[2], membership_status: 'active' }], tournament_players: [{ id: ids[2], user_id: ids[2], status: 'approved', joined_via: 'link' }], stages: [], rounds: [], standings: [], matches: [{ id: 'past', team_a_id: ids[1], status: 'validated', outcome_kind: 'played', score_a: 11, score_b: 5, player_a1_id: ids[2] }, { id: 'next', team_b_id: ids[1], status: 'scheduled', player_b1_id: ids[2] }] };
}
test('withdrawal preserves the team and played history, clears only frozen pending identities, and binds the revision', () => {
 const s=snapshot(), before=JSON.stringify(s), preview=previewPlayerWithdrawal(s,actor,data);
 assert.equal(JSON.stringify(s),before); assert.deepEqual(preview.historical_match_ids,['past']); assert.deepEqual(preview.pending_match_ids,['next']);
 const plan=planPlayerWithdrawal(s,actor,{...data,preview_hash:preview.preview_hash});
 assert.match(confirmationQuestion('admin_preview_player_withdrawal',preview)!, /keep the team/i);
 assert.equal((publicMcpResult('admin_preview_player_withdrawal',{...preview,email:'private@example.invalid'}) as Record<string,unknown>).email,undefined);
 assert.equal(plan.effects.teams,undefined); assert.deepEqual(plan.effects.matches,[{id:'next',player_b1_id:null}]);
 assert.equal(plan.effects.team_members?.[0].membership_status,'cancelled');
 assert.throws(()=>planPlayerWithdrawal({...s,event:{...s.event!,revision:5}},actor,{...data,preview_hash:preview.preview_hash}),{code:'STALE_PREVIEW'});
 assert.throws(()=>previewPlayerWithdrawal(s,{id:ids[3],clientId:'web'},data),{code:'FORBIDDEN'});
});
test('withdrawal stops for live games, ambiguous history or unrelated frozen pending players', () => {
 for (const edit of [ (s:CommandSnapshot)=>{s.matches[0].status='in_progress';s.matches[0].is_current=true;}, (s:CommandSnapshot)=>{delete s.matches[0].player_a1_id;}, (s:CommandSnapshot)=>{s.matches[1].player_b1_id=ids[0];} ]) {
  const s=snapshot(); edit(s); const preview=previewPlayerWithdrawal(s,actor,data);
  assert.equal(confirmationQuestion('admin_preview_player_withdrawal',preview),undefined);
  assert.throws(()=>planPlayerWithdrawal(s,actor,{...data,preview_hash:preview.preview_hash}),{code:'INVALID_STATE'});
 }
 const walkover=snapshot(); walkover.matches[0]={id:'old-walkover',team_a_id:ids[1],status:'walkover',outcome_kind:'walkover'};
 assert.deepEqual(previewPlayerWithdrawal(walkover,actor,data).unknown_history_match_ids,[]);
});
