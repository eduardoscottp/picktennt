import type { CommandSnapshot, StorageRow } from './commands';
export interface GuestPlayer { id: string; name: string }
export function guestPlayers(team: StorageRow | undefined): GuestPlayer[] {
 return Array.isArray(team?.guest_players) ? team.guest_players as GuestPlayer[] : [];
}
/** Tournament-only guest IDs never represent authentication accounts or signed consent. */
export function entryPlayerIds(snapshot: Pick<CommandSnapshot, 'teams' | 'team_members'>, teamId: string): string[] {
 // Withdrawn entrants remain part of the locked competition history; cancelled
 // pre-play memberships were replaced or removed and must not enter a new draw.
 return [...snapshot.team_members.filter(m=>m.team_id===teamId && m.membership_status!=='cancelled').map(m=>String(m.user_id)), ...guestPlayers(snapshot.teams.find(t=>t.id===teamId)).map(g=>g.id)];
}
