import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot } from './commands';
import { positionedMembers } from './individual-roster';
import { resolvedDefinition } from './resolved-definition';
import { DomainError, UUID } from './requests';

export function planAdminFillPosition(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  const event = snapshot.event;
  if (!event) throw new DomainError('NOT_FOUND', 'Tournament not found.');
  if (event.created_by !== actor.id && actor.role !== 'admin') throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (!['registration_open', 'registration_closed', 'ready', 'active'].includes(String(event.modular_state))) throw new DomainError('INVALID_STATE', 'A position cannot be filled in this tournament state.');
  const definition = resolvedDefinition(snapshot)?.definition as { registration?: { entry_type?: string; max_entries?: number } } | undefined;
  const type = definition?.registration?.entry_type, max = definition?.registration?.max_entries;
  if (!['singles', 'fixed_doubles'].includes(String(type)) || !Number.isInteger(max)) throw new DomainError('INVALID_DEFINITION', 'A supported published registration is required.');
  const user = typeof data.user_id === 'string' && UUID.test(data.user_id) ? data.user_id.toLowerCase() : '';
  const slot = data.slot_index, position = data.position, size = type === 'singles' ? 1 : 2;
  if (!user || !Number.isInteger(slot) || Number(slot) < 1 || Number(slot) > Number(max) || !Number.isInteger(position) || Number(position) < 1 || Number(position) > size || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 1000) throw new DomainError('INVALID_REQUEST', 'Choose an account, available position and reason.');
  if (snapshot.team_members.some(member => member.user_id === user && ['active', 'pending'].includes(String(member.membership_status)))) throw new DomainError('DUPLICATE_ENTRY', 'This account already has a current team or invitation.');
  const team = snapshot.teams.find(row => Number(row.registration_slot) === slot);
  if (!team && snapshot.matches.length) throw new DomainError('STRUCTURE_LOCKED', 'A new team cannot be added after games are generated without reviewing the schedule.');
  if (team && team.entry_state !== 'approved') throw new DomainError('INVALID_STATE', 'The team is not active.');
  const active = snapshot.team_members.filter(member => member.team_id === team?.id && ['active', 'pending'].includes(String(member.membership_status)));
  if (active.length >= size || positionedMembers(active, size)[Number(position) - 1]) throw new DomainError('SLOT_FULL', 'This position is occupied.');
  const historic = snapshot.matches.filter(match => (match.team_a_id === team?.id || match.team_b_id === team?.id) && (match.started_at || match.score_a != null || match.score_b != null || ['in_progress', 'score_entered', 'validated', 'walkover', 'disputed'].includes(String(match.status))));
  if (historic.some(match => { if (match.outcome_kind === 'walkover' && !match.started_at && match.score_a == null && match.score_b == null) return false; const side = match.team_a_id === team?.id ? 'a' : 'b'; const players = [match[`player_${side}1_id`], match[`player_${side}2_id`]].filter(id => typeof id === 'string'); return players.length !== size || new Set(players).size !== size; })) throw new DomainError('STRUCTURE_LOCKED', 'Historical match player identities are incomplete; review them before filling this position.');
  const fixtures = snapshot.matches.filter(match => match.is_current !== false && !match.voided_at && (match.team_a_id === team?.id || match.team_b_id === team?.id));
  const pendingUpdates = fixtures.flatMap(match => {
    if (match.status === 'in_progress') throw new DomainError('STRUCTURE_LOCKED', 'A live game must be resolved before filling this position.');
    if (match.status !== 'scheduled') return [];
    if (match.started_at || match.score_a != null || match.score_b != null) throw new DomainError('STRUCTURE_LOCKED', 'Review this pending game before filling the position.');
    const side = match.team_a_id === team?.id ? 'a' : 'b';
    const players = [match[`player_${side}1_id`], match[`player_${side}2_id`]].filter((id): id is string => typeof id === 'string');
    if (!players.length) return [];
    const memberIds = active.filter(member => member.membership_status === 'active').map(member => String(member.user_id));
    if (active.length !== memberIds.length || players.length !== memberIds.length || new Set(players).size !== players.length || players.some(id => !memberIds.includes(id)) || players.length >= size) throw new DomainError('STRUCTURE_LOCKED', 'Pending match players do not match the current team; review the schedule before filling this position.');
    const field = match[`player_${side}1_id`] == null ? `player_${side}1_id` : `player_${side}2_id`;
    return [{ id: match.id, [field]: user }];
  });
  const teamId = team?.id ?? context.id();
  const previous = snapshot.team_members.find(member => member.team_id === teamId && member.user_id === user);
  const player = snapshot.tournament_players.find(row => row.user_id === user);
  if (player?.status !== 'approved' && snapshot.tournament_players.filter(row => row.status === 'approved').length >= Number(max) * size) throw new DomainError('CAPACITY_FULL', 'The tournament has no available player positions.');
  if (typeof event.definition_id !== 'string') throw new DomainError('INVALID_STATE', 'Published rules are unavailable.');
  return { effects: {
    event: { roster_revision: Number(event.roster_revision ?? 0) + 1 },
    teams: [team ? { id: teamId, admin_definition_id: event.definition_id, registered_by: actor.id } : { id: teamId, name: `Team ${slot}`, entry_state: 'approved', registration_slot: slot, admin_definition_id: event.definition_id, registered_by: actor.id }],
    team_members: [{ id: previous?.id ?? context.id(), team_id: teamId, user_id: user, membership_status: 'active', admission_source: 'administrator', player_slot: position, consented_at: previous?.consented_at ?? null, consented_definition_id: previous?.consented_definition_id ?? null }],
    tournament_players: [{ id: player?.id ?? context.id(), user_id: user, status: 'approved', joined_via: player?.joined_via ?? 'link', exit_reason: null, nullified_from_standings: false }],
    ...(pendingUpdates.length ? { matches: pendingUpdates } : {}),
  }, result: { entry_id: teamId, user_id: user, slot_index: slot, position, player_status: 'approved' } };
}
