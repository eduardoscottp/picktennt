import type { Match } from "@/types/database";

export interface StandingRow {
  id: string; // team or player id
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsForInLosses: number; // tiebreaker 3: points scored in games they lost
  rank: number;
}

interface StandingData {
  wins: number;
  losses: number;
  pf: number;
  pa: number;
  pfInLosses: number;
}

/**
 * Tiebreaker order:
 * 1. Wins (descending)
 * 2. Points against (ascending) — fewer conceded = better
 * 3. Points for in losses (descending) — more points scored while losing = better
 */
export function computeStandings(
  matches: Match[],
  entityKey: "team" | "player"
): StandingRow[] {
  const validated = matches.filter((m) => m.status === "validated");
  const map = new Map<string, StandingData>();

  function ensure(id: string) {
    if (!map.has(id)) map.set(id, { wins: 0, losses: 0, pf: 0, pa: 0, pfInLosses: 0 });
  }

  for (const m of validated) {
    if (entityKey === "team") {
      if (!m.team_a_id || !m.team_b_id || m.score_a == null || m.score_b == null) continue;
      ensure(m.team_a_id);
      ensure(m.team_b_id);
      const a = map.get(m.team_a_id)!;
      const b = map.get(m.team_b_id)!;
      a.pf += m.score_a; a.pa += m.score_b;
      b.pf += m.score_b; b.pa += m.score_a;
      if (m.score_a > m.score_b) {
        a.wins++; b.losses++;
        b.pfInLosses += m.score_b;
      } else if (m.score_b > m.score_a) {
        b.wins++; a.losses++;
        a.pfInLosses += m.score_a;
      } else {
        a.wins += 0.5; b.wins += 0.5;
      }
    } else {
      // Mixed — individual tracking
      if (m.score_a == null || m.score_b == null) continue;
      const sideAIds = [m.player_a1_id, m.player_a2_id].filter(Boolean) as string[];
      const sideBIds = [m.player_b1_id, m.player_b2_id].filter(Boolean) as string[];
      for (const pid of sideAIds) { ensure(pid); map.get(pid)!.pf += m.score_a!; map.get(pid)!.pa += m.score_b!; }
      for (const pid of sideBIds) { ensure(pid); map.get(pid)!.pf += m.score_b!; map.get(pid)!.pa += m.score_a!; }
      if (m.score_a !== m.score_b) {
        const winnerIds = m.score_a > m.score_b ? sideAIds : sideBIds;
        const loserIds  = m.score_a > m.score_b ? sideBIds : sideAIds;
        const loserScore = m.score_a > m.score_b ? m.score_b : m.score_a;
        for (const pid of winnerIds) { map.get(pid)!.wins++; }
        for (const pid of loserIds)  { map.get(pid)!.losses++; map.get(pid)!.pfInLosses += loserScore!; }
      }
    }
  }

  const rows = [...map.entries()].map(([id, s]) => ({
    id,
    wins: s.wins,
    losses: s.losses,
    pointsFor: s.pf,
    pointsAgainst: s.pa,
    pointsForInLosses: s.pfInLosses,
    rank: 0,
  }));

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst;
    return b.pointsForInLosses - a.pointsForInLosses;
  });

  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * Par Match seeding: 1st vs last, 2nd vs 2nd-last, etc.
 */
export function buildParMatchBracket(rankedIds: string[]): Array<[string, string]> {
  const n = rankedIds.length;
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < Math.floor(n / 2); i++) {
    pairs.push([rankedIds[i], rankedIds[n - 1 - i]]);
  }
  return pairs;
}
