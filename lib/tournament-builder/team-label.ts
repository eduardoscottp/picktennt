import type { CommandSnapshot, StorageRow } from './commands';
import { positionedMembers } from './individual-roster';

export function automaticTeamName(names: string[], doubles: boolean, fallback: string): string {
  const present = names.map(name => name.trim()).filter(Boolean);
  return present.length ? present.map(name => doubles ? name.split(/\s+/)[0] : name).join(' / ') : fallback;
}

export function hasCustomTeamName(team: StorageRow | undefined): boolean {
  return typeof team?.name === 'string' && !!team.name.trim() && !/^(team|entry)(\s+\d+)?$/i.test(team.name.trim());
}

/** A custom team name wins; automatic labels follow the current roster. */
export function tournamentTeamLabel(snapshot: Pick<CommandSnapshot, 'teams' | 'team_members'>, team: StorageRow | undefined, doubles: boolean, fallbackIndex: number): string {
  const fallback = `Team ${Number(team?.registration_slot) || fallbackIndex}`;
  if (!team) return fallback;
  const stored = typeof team.name === 'string' ? team.name.trim() : '';
  if (hasCustomTeamName(team)) return stored;
  const members = snapshot.team_members.filter(member => member.team_id === team.id && member.membership_status === 'active');
  const names = positionedMembers(members, doubles ? 2 : 1)
    .map(member => typeof member?.display_name === 'string' ? member.display_name.trim() : '')
    .filter(Boolean);
  return automaticTeamName(names, doubles, fallback);
}
