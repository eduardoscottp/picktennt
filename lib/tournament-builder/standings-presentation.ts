import type { StorageRow } from './commands';

/** Historical results remain visible; eligibility controls current rank and awards. */
export function presentStandings(standings: readonly StorageRow[], teams: readonly StorageRow[], excluded: readonly string[] = []): StorageRow[] {
  const groups = new Map<unknown, StorageRow[]>();
  for (const row of standings) {
    const team = teams.find(team => team.id === row.team_id);
    const eligible = row.eligible !== false && (!team || team.entry_state === 'approved') && !excluded.includes(String(row.team_id));
    const group = groups.get(row.stage_id) ?? [];
    group.push({ ...row, eligible });
    groups.set(row.stage_id, group);
  }
  return [...groups.values()].flatMap(group => {
    const staleRanks = group.some(row => !row.eligible && row.rank != null);
    const ordered = [...group].sort((a, b) => Number(!a.eligible) - Number(!b.eligible) || Number(a.rank ?? Infinity) - Number(b.rank ?? Infinity));
    const ineligibleIds = new Set([...excluded, ...teams.filter(team => team.entry_state !== 'approved').map(team => team.id), ...ordered.filter(row => !row.eligible).map(row => String(row.team_id))]);
    let previous: unknown, rank = 0;
    return ordered.map((row, index) => {
      if (!row.eligible) return { ...row, rank: null, tie_group: null };
      if (row.rank != null && row.rank !== previous) rank = index + 1;
      previous = row.rank;
      const tie = typeof row.tie_group === 'string' ? row.tie_group.split(',').filter(id => !ineligibleIds.has(id)) : [];
      return { ...row, rank: staleRanks && row.rank != null ? rank : row.rank, tie_group: tie.length > 1 ? tie.join(',') : null };
    });
  });
}
