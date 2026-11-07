import type { CommandSnapshot, StorageRow } from './commands';

/** Only snapshots obtained from the trusted storage boundary may supply this field. */
export function isEligibleEntry(snapshot: CommandSnapshot, team: StorageRow): boolean {
  return team.entry_state === 'approved' && !snapshot.disciplinary_excluded_team_ids?.includes(team.id);
}
