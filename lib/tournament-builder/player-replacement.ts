import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot } from './commands';
import { definitionHash, DomainError, UUID } from './requests';
import { resolvedDefinition } from './resolved-definition';

export function previewPlayerReplacement(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  const event = snapshot.event;
  if (!event) throw new DomainError('NOT_FOUND', 'Tournament not found.');
  if (event.created_by !== actor.id && actor.role !== 'admin') throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (!['registration_open', 'registration_closed', 'ready', 'active'].includes(String(event.modular_state))) throw new DomainError('INVALID_STATE', 'A player cannot be replaced in this tournament state.');
  if (Object.keys(data).some(key => !['team_id', 'old_user_id', 'new_user_id', 'reason'].includes(key))) throw new DomainError('INVALID_REQUEST', 'Unexpected replacement field.');
  const { team_id, old_user_id, new_user_id, reason } = data;
  if (![team_id, old_user_id, new_user_id].every(id => typeof id === 'string' && UUID.test(id)) || old_user_id === new_user_id || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new DomainError('INVALID_REQUEST', 'Choose different player accounts and provide a reason.');
  if (!snapshot.teams.some(team => team.id === team_id && team.entry_state === 'approved') || !snapshot.team_members.some(member => member.team_id === team_id && member.user_id === old_user_id && member.membership_status === 'active')) throw new DomainError('NOT_FOUND', 'Choose a current player in an approved team.');
  if (snapshot.team_members.filter(member => member.user_id === old_user_id && ['active', 'pending'].includes(String(member.membership_status))).length !== 1) throw new DomainError('INVALID_STATE', 'Resolve the current player’s other active or pending entries first.');
  if (snapshot.team_members.some(member => member.user_id === new_user_id && ['active', 'pending'].includes(String(member.membership_status)))) throw new DomainError('DUPLICATE_ENTRY', 'The replacement already has a current team or invitation.');
  const matches = snapshot.matches.filter(match => match.team_a_id === team_id || match.team_b_id === team_id);
  const definition = resolvedDefinition(snapshot)?.definition as { registration?: { entry_type?: string } } | undefined;
  const expectedPlayers = definition?.registration?.entry_type === 'fixed_doubles' ? 2 : 1;
  const future = matches.filter(match => match.is_current !== false && !match.voided_at && match.status === 'scheduled' && !match.started_at && match.score_a == null && match.score_b == null);
  const preserved = matches.filter(match => !!match.started_at || match.score_a != null || match.score_b != null || ['in_progress', 'score_entered', 'validated', 'walkover', 'disputed'].includes(String(match.status)));
  const frozenFuture = future.filter(match => {
    const side = match.team_a_id === team_id ? 'a' : 'b';
    const players = [match[`player_${side}1_id`], match[`player_${side}2_id`]].filter(id => typeof id === 'string');
    return players.length > 0 && (new Set(players).size !== expectedPlayers || !players.some(id => id === old_user_id));
  });
  const unknown = preserved.filter(match => {
    if (match.outcome_kind === 'walkover' && !match.started_at && match.score_a == null && match.score_b == null) return false;
    const side = match.team_a_id === team_id ? 'a' : 'b';
    const players = [match[`player_${side}1_id`], match[`player_${side}2_id`]].filter(id => typeof id === 'string');
    return new Set(players).size !== expectedPlayers;
  });
  const impact = { tournament_id: event.id, event_revision: Number(event.revision), team_id, old_user_id, new_user_id, reason: reason.trim(), future_match_ids: future.map(match => match.id).sort(), preserved_match_ids: preserved.map(match => match.id).sort(), unknown_history_match_ids: unknown.map(match => match.id).sort(), blocked_future_match_ids: frozenFuture.map(match => match.id).sort() };
  return { ...impact, preview_hash: definitionHash(impact) };
}

export function planPlayerReplacement(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  const { preview_hash, ...proposal } = data;
  const preview = previewPlayerReplacement(snapshot, actor, proposal);
  if (preview_hash !== preview.preview_hash) throw new DomainError('STALE_PREVIEW', 'Review the current replacement impact before confirming.');
  if (preview.unknown_history_match_ids.length) throw new DomainError('INVALID_STATE', 'Historical match players are incomplete; resolve them before replacing a player.');
  const teamId = String(preview.team_id), oldId = String(preview.old_user_id), newId = String(preview.new_user_id);
  const old = snapshot.team_members.find(member => member.team_id === teamId && member.user_id === oldId && member.membership_status === 'active')!;
  const previous = snapshot.team_members.find(member => member.team_id === teamId && member.user_id === newId);
  const definitionId = snapshot.event?.definition_id;
  if (typeof definitionId !== 'string') throw new DomainError('INVALID_STATE', 'The published tournament definition is unavailable.');
  if (preview.blocked_future_match_ids.length) throw new DomainError('INVALID_STATE', 'A pending match already has recorded players and needs a separate review.');
  const oldPlayer = snapshot.tournament_players.find(player => player.user_id === oldId);
  const newPlayer = snapshot.tournament_players.find(player => player.user_id === newId);
  const futureUpdates = snapshot.matches.filter(match => preview.future_match_ids.includes(match.id)).flatMap(match => {
    const side = match.team_a_id === teamId ? 'a' : 'b';
    const changes: Record<string, string> = {};
    for (const position of [1, 2]) if (match[`player_${side}${position}_id`] === oldId) changes[`player_${side}${position}_id`] = newId;
    return Object.keys(changes).length ? [{ id: match.id, ...changes }] : [];
  });
  return {
    effects: {
      event: { roster_revision: Number(snapshot.event!.roster_revision ?? 0) + 1 },
      teams: [{ id: teamId, admin_definition_id: definitionId, registered_by: actor.id }],
      team_members: [
        { id: old.id, membership_status: 'cancelled' },
        { id: previous?.id ?? context.id(), team_id: teamId, user_id: newId, membership_status: 'active', admission_source: 'administrator', consented_at: previous?.consented_at ?? null, consented_definition_id: previous?.consented_definition_id ?? null, player_slot: old.player_slot ?? null },
      ],
      tournament_players: [
        { id: oldPlayer?.id ?? context.id(), user_id: oldId, status: 'rejected', joined_via: oldPlayer?.joined_via ?? 'link' },
        { id: newPlayer?.id ?? context.id(), user_id: newId, status: 'approved', joined_via: newPlayer?.joined_via ?? 'link' },
      ],
      ...(futureUpdates.length ? { matches: futureUpdates } : {}),
    },
    result: { team_id: teamId, old_user_id: oldId, new_user_id: newId, preserved_match_ids: preview.preserved_match_ids, future_match_ids: preview.future_match_ids },
  };
}
