import type { CommandSnapshot, StorageRow } from './commands';
import type { TournamentDefinition } from './definition';
import { resolvedDefinition } from './resolved-definition';

/** Preserve explicit positions; historical memberships retain their stable snapshot order. */
export function positionedMembers(members: StorageRow[], size: number): (StorageRow | undefined)[] {
  const positions: (StorageRow | undefined)[] = Array.from({ length: size });
  for (const member of members.filter(row => Number.isInteger(row.player_slot) && Number(row.player_slot) >= 1 && Number(row.player_slot) <= size)) positions[Number(member.player_slot) - 1] = member;
  for (const member of members.filter(row => row.player_slot == null)) {
    const empty = positions.findIndex(row => !row);
    if (empty >= 0) positions[empty] = member;
  }
  return positions;
}

export function individualRoster(snapshot: CommandSnapshot) {
  const definition = resolvedDefinition(snapshot)?.definition as TournamentDefinition | undefined;
  if (!definition?.registration || !Number.isInteger(definition.registration.max_entries) || definition.registration.max_entries < 1 || definition.registration.max_entries > 16) return null;
  const size = definition.registration.entry_type === 'singles' ? 1 : 2;
  const editable = snapshot.event?.modular_state === 'registration_open' && !snapshot.matches.length && Date.parse(definition.registration.closes_at) > Date.now();
  return {
    capacity: definition.registration.max_entries * size,
    editable,
    allowed_actions: editable ? ['join', 'select_own_position', 'cancel_own_registration', ...(['owner', 'admin'].includes(String((snapshot as CommandSnapshot & { caller_role?: string }).caller_role)) ? ['place_registered_player', 'remove_registered_player', 'release_position'] : [])] : [],
    slots: Array.from({ length: definition.registration.max_entries }, (_, index) => {
      const team = snapshot.teams.find(row => Number(row.registration_slot) === index + 1);
      const members = positionedMembers(snapshot.team_members.filter(row => row.team_id === team?.id && row.membership_status === 'active'), size);
      return { slot_index: index + 1, positions: members.map((member, position) => ({
        position: position + 1, state: member ? 'occupied' : editable ? 'available' : 'locked',
        ...(member ? { profile_id: typeof member.user_id === 'string' ? member.user_id : undefined, display_name: typeof member.display_name === 'string' ? member.display_name : undefined } : {}),
      })) };
    }),
  };
}
