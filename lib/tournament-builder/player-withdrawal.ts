import type { CommandActor, CommandPlan, CommandSnapshot } from './commands';
import { definitionHash, DomainError, UUID } from './requests';
import { resolvedDefinition } from './resolved-definition';

export function previewPlayerWithdrawal(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  const event = snapshot.event;
  if (!event) throw new DomainError('NOT_FOUND', 'Tournament not found.');
  if ((event.created_by !== actor.id && actor.role !== 'admin') || (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage'))) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (!['registration_open', 'registration_closed', 'ready', 'active'].includes(String(event.modular_state))) throw new DomainError('INVALID_STATE', 'A player cannot be withdrawn in this tournament state.');
  if (Object.keys(data).some(key => !['team_id', 'user_id', 'reason'].includes(key))) throw new DomainError('INVALID_REQUEST', 'Unexpected withdrawal field.');
  const { team_id, user_id, reason } = data;
  if (![team_id, user_id].every(id => typeof id === 'string' && UUID.test(id)) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new DomainError('INVALID_REQUEST', 'Choose a player and provide a reason.');
  if (!snapshot.teams.some(team => team.id === team_id && team.entry_state === 'approved') || !snapshot.team_members.some(member => member.team_id === team_id && member.user_id === user_id && member.membership_status === 'active')) throw new DomainError('NOT_FOUND', 'Choose a current player in an approved team.');
  if (!snapshot.tournament_players.some(player => player.user_id === user_id && player.status === 'approved')) throw new DomainError('INVALID_STATE', 'The active participant registration is missing.');
  if (snapshot.team_members.filter(member => member.user_id === user_id && ['active', 'pending'].includes(String(member.membership_status))).length !== 1) throw new DomainError('INVALID_STATE', 'Resolve the player’s other active or pending entries first.');
  const definition = resolvedDefinition(snapshot)?.definition as { registration?: { entry_type?: string } } | undefined;
  const size = definition?.registration?.entry_type === 'fixed_doubles' ? 2 : 1;
  const matches = snapshot.matches.filter(match => match.team_a_id === team_id || match.team_b_id === team_id);
  const activeIds = snapshot.team_members.filter(member => member.team_id === team_id && member.membership_status === 'active').map(member => member.user_id);
  const historical = matches.filter(match => !!match.started_at || match.score_a != null || match.score_b != null || ['in_progress', 'score_entered', 'validated', 'walkover', 'disputed'].includes(String(match.status)));
  const live = matches.filter(match => match.is_current !== false && !match.voided_at && match.status === 'in_progress');
  const pending = matches.filter(match => match.is_current !== false && !match.voided_at && match.status === 'scheduled' && !match.started_at && match.score_a == null && match.score_b == null && !match.outcome_kind);
  const unknown = historical.filter(match => { if (match.outcome_kind === 'walkover' && !match.started_at && match.score_a == null && match.score_b == null) return false; const side = match.team_a_id === team_id ? 'a' : 'b'; const players = [match[`player_${side}1_id`], match[`player_${side}2_id`]].filter(id => typeof id === 'string'); return players.length !== size || new Set(players).size !== size; });
  const inconsistent = [...matches.filter(match => match.is_current !== false && !match.voided_at && match.status === 'scheduled' && (!!match.started_at || match.score_a != null || match.score_b != null || !!match.outcome_kind)), ...pending.filter(match => { const side = match.team_a_id === team_id ? 'a' : 'b'; const players = [match[`player_${side}1_id`], match[`player_${side}2_id`]].filter(id => typeof id === 'string'); return players.length > 0 && (players.length !== activeIds.length || new Set(players).size !== players.length || players.some(id => !activeIds.includes(id)) || !players.includes(String(user_id))); })];
  const impact = { tournament_id: event.id, event_revision: Number(event.revision), team_id, user_id, reason: reason.trim(), historical_match_ids: historical.map(match => match.id).sort(), pending_match_ids: pending.map(match => match.id).sort(), live_match_ids: live.map(match => match.id).sort(), unknown_history_match_ids: unknown.map(match => match.id).sort(), inconsistent_pending_match_ids: inconsistent.map(match => match.id).sort() };
  return { ...impact, preview_hash: definitionHash(impact) };
}

export function planPlayerWithdrawal(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>): CommandPlan {
  const { preview_hash, ...proposal } = data, review = previewPlayerWithdrawal(snapshot, actor, proposal);
  if (preview_hash !== review.preview_hash) throw new DomainError('STALE_PREVIEW', 'Review the current withdrawal impact.');
  if (review.live_match_ids.length || review.unknown_history_match_ids.length || review.inconsistent_pending_match_ids.length) throw new DomainError('INVALID_STATE', 'Resolve live games, missing history or inconsistent pending players before withdrawing.');
  const member = snapshot.team_members.find(row => row.team_id === review.team_id && row.user_id === review.user_id && row.membership_status === 'active')!;
  const player = snapshot.tournament_players.find(row => row.user_id === review.user_id);
  if (!player || player.status !== 'approved') throw new DomainError('INVALID_STATE', 'The active participant registration is missing.');
  const matches = snapshot.matches.filter(match => review.pending_match_ids.includes(match.id)).flatMap(match => {
    const side = match.team_a_id === review.team_id ? 'a' : 'b', changes: Record<string, null> = {};
    for (const position of [1, 2]) if (match[`player_${side}${position}_id`] === review.user_id) changes[`player_${side}${position}_id`] = null;
    return Object.keys(changes).length ? [{ id: match.id, ...changes }] : [];
  });
  return { effects: { event: { roster_revision: Number(snapshot.event!.roster_revision ?? 0) + 1 }, team_members: [{ id: member.id, membership_status: 'cancelled' }], tournament_players: [{ id: player.id, user_id: review.user_id, status: 'rejected', joined_via: player.joined_via ?? 'link', exit_reason: 'withdrew', nullified_from_standings: false }], ...(matches.length ? { matches } : {}) }, result: { team_id: review.team_id, user_id: review.user_id, preserved_match_ids: review.historical_match_ids, future_match_ids: review.pending_match_ids } };
}
