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

/** Show older teams without stored registration slots in otherwise empty display positions. */
export function displayRosterTeams(teams: StorageRow[], capacity: number, includeUnslotted: boolean): (StorageRow | undefined)[] {
  const slots = Array.from({ length: capacity }, (_, index) => teams.find(team => Number(team.registration_slot) === index + 1));
  if (includeUnslotted) {
    for (const team of teams.filter(row => row.registration_slot == null && row.entry_state === 'approved')) {
      const empty = slots.findIndex(row => !row);
      if (empty < 0) slots.push(team); else slots[empty] = team;
    }
  }
  return slots;
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
      const members = positionedMembers(snapshot.team_members.filter(row => row.team_id === team?.id && ['active', 'pending'].includes(String(row.membership_status))), size);
      return { slot_index: index + 1, positions: members.map((member, position) => ({
        position: position + 1, state: member ? 'occupied' : editable ? 'available' : 'locked',
        ...(member ? { profile_id: typeof member.user_id === 'string' ? member.user_id : undefined, display_name: typeof member.display_name === 'string' ? member.display_name : undefined } : {}),
      })) };
    }),
  };
}

export function adminPlacement(members: StorageRow[], userId: string, locked: boolean): 'add' | 'move' | 'blocked' {
  const current = members.find(row => row.user_id === userId && ['active', 'pending'].includes(String(row.membership_status)));
  return !current ? 'add' : current.membership_status === 'active' && !locked ? 'move' : 'blocked';
}

/** Approved registrations without a current team still consume capacity. */
export function unassignedRegisteredPlayers(snapshot: CommandSnapshot): StorageRow[] {
  return snapshot.tournament_players.filter(player => player.status === 'approved' && !snapshot.team_members.some(member => member.user_id === player.user_id && ['active', 'pending'].includes(String(member.membership_status))));
}
