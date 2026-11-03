import type { RankingKey } from './definition';

export type OutcomeKind = 'played' | 'walkover' | 'retirement' | 'no_contest';
export interface StandingResult {
  a: string;
  b: string;
  scoreA?: number | null;
  scoreB?: number | null;
  outcome: OutcomeKind;
  winner?: string | null;
  accepted: boolean;
}
export interface StandingRow {
  entryId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsForInLosses: number;
}

export function isLegalScore(a: number, b: number, policy: { target: number; win_by: number }): boolean {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a === b) return false;
  const high = Math.max(a, b), low = Math.min(a, b);
  return high >= policy.target && high - low >= policy.win_by &&
    (high === policy.target || (policy.win_by > 1 && high - low === policy.win_by));
}

/** Accepted current results only. Draws are persisted by the command layer, never generated here. */
export function computeStandings(
  entries: readonly string[], results: readonly StandingResult[], order: readonly RankingKey[],
  draws: readonly (readonly string[])[] = [], excluded: readonly string[] = [],
): { rows: StandingRow[]; ties: string[][] } {
  const rows = entries.filter(id => !excluded.includes(id)).map(entryId => ({
    entryId, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, pointsForInLosses: 0,
  }));
  const byId = new Map(rows.map(row => [row.entryId, row]));
  for (const result of results) {
    if (!result.accepted || result.outcome === 'no_contest') continue;
    const a = byId.get(result.a), b = byId.get(result.b);
    if (!a || !b) continue;
    let winner = result.winner;
    if (result.outcome === 'played') {
      if (result.scoreA == null || result.scoreB == null || result.scoreA === result.scoreB) {
        throw new Error('Accepted played result must have unequal scores');
      }
      winner = result.scoreA > result.scoreB ? a.entryId : b.entryId;
      a.pointsFor += result.scoreA; a.pointsAgainst += result.scoreB;
      b.pointsFor += result.scoreB; b.pointsAgainst += result.scoreA;
      if (winner === a.entryId) b.pointsForInLosses += result.scoreB;
      else a.pointsForInLosses += result.scoreA;
    }
    if (winner !== a.entryId && winner !== b.entryId) throw new Error('Accepted outcome requires a participating winner');
    (winner === a.entryId ? a : b).wins++;
    (winner === a.entryId ? b : a).losses++;
  }
  const value = (row: StandingRow, key: RankingKey): number => {
    switch (key) {
      case 'wins_desc': return row.wins;
      case 'differential_desc': return row.pointsFor - row.pointsAgainst;
      case 'points_for_desc': return row.pointsFor;
      case 'points_against_asc': return -row.pointsAgainst;
      case 'points_for_in_losses_desc': return row.pointsForInLosses;
    }
  };
  const compare = (a: StandingRow, b: StandingRow) => {
    for (const key of order) { const delta = value(b, key) - value(a, key); if (delta) return delta; }
    return 0;
  };
  rows.sort(compare);
  const ties: string[][] = [];
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && compare(rows[start], rows[end]) === 0) end++;
    if (end - start > 1) {
      const group = rows.slice(start, end).map(row => row.entryId);
      const draw = draws.find(d => d.length === group.length && new Set(d).size === d.length && group.every(id => d.includes(id)));
      if (draw) rows.splice(start, group.length, ...draw.map(id => byId.get(id)!));
      else ties.push(group);
    }
    start = end;
  }
  return { rows, ties };
}
