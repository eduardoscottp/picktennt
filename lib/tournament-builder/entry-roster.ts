import type { CommandSnapshot, StorageRow } from './commands';
export interface GuestPlayer { id: string; name: string }
export function guestPlayers(team: StorageRow | undefined): GuestPlayer[] {
 return Array.isArray(team?.guest_players) ? team.guest_players as GuestPlayer[] : [];
}
/** Tournament-only guest IDs never represent authentication accounts or signed consent. */
export function entryPlayerIds(snapshot: Pick<CommandSnapshot, 'teams' | 'team_members'>, teamId: string): string[] {
 // A withdrawn team retains its historical roster; an active team uses its current members.
 const team = snapshot.teams.find(t=>t.id===teamId);
 return [...snapshot.team_members.filter(m=>m.team_id===teamId && (m.membership_status==='active' || (team?.entry_state!=='approved' && m.membership_status==='pending') || (team?.entry_state==='withdrawn' && m.membership_status==='withdrawn'))).map(m=>String(m.user_id)), ...guestPlayers(team).map(g=>g.id)];
}
