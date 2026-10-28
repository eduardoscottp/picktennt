import type { CommandSnapshot, StorageRow } from './commands';
export interface GuestPlayer { id: string; name: string }
export function guestPlayers(team: StorageRow | undefined): GuestPlayer[] {
 return Array.isArray(team?.guest_players) ? team.guest_players as GuestPlayer[] : [];
}
/** Tournament-only guest IDs never represent authentication accounts or signed consent. */
export function entryPlayerIds(snapshot: Pick<CommandSnapshot, 'teams' | 'team_members'>, teamId: string): string[] {
 return [...snapshot.team_members.filter(m=>m.team_id===teamId).map(m=>String(m.user_id)), ...guestPlayers(snapshot.teams.find(t=>t.id===teamId)).map(g=>g.id)];
}
