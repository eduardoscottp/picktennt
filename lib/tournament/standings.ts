import type { Match, Standing } from "@/types/database";

export interface StandingRow {
  id: string; // team or player id
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
}

/**
 * Compute standings from validated matches.
 *
 * Tiebreaker:
 * 1. Wins (descending)
 * 2. Among tied teams: points scored by opponents against *them* in
 *    head-to-head matches — fewer points against = better rank
 */
export function computeStandings(
  matches: Match[],
  entityKey: "team" | "player"
): StandingRow[] {
  const validated = matches.filter((m) => m.status === "validated");
  const map = new Map<string, { wins: number; losses: number; pf: number; pa: number }>();

  function ensure(id: string) {
    if (!map.has(id)) map.set(id, { wins: 0, losses: 0, pf: 0, pa: 0 });
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
      if (m.score_a > m.score_b) { a.wins++; b.losses++; }
      else if (m.score_b > m.score_a) { b.wins++; a.losses++; }
      else { a.wins += 0.5; b.wins += 0.5; } // draw
    } else {
      // Mixed — individual tracking
      const players = [
        [m.player_a1_id, m.player_a2_id, m.score_a, m.score_b],
        [m.player_a2_id, m.player_a1_id, m.score_a, m.score_b],
        [m.player_b1_id, m.player_b2_id, m.score_b, m.score_a],
        [m.player_b2_id, m.player_b1_id, m.score_b, m.score_a],
      ] as [string | null, string | null, number | null, number | null][];

      if (m.score_a == null || m.score_b == null) continue;

      for (const [pid, , pf, pa] of players) {
        if (!pid) continue;
        ensure(pid);
        const row = map.get(pid)!;
        row.pf += pf ?? 0;
        row.pa += pa ?? 0;
      }

      // Win/loss per player
      if (m.score_a !== m.score_b) {
        const winnerPids = m.score_a > m.score_b
          ? [m.player_a1_id, m.player_a2_id]
          : [m.player_b1_id, m.player_b2_id];
        const loserPids = m.score_a > m.score_b
          ? [m.player_b1_id, m.player_b2_id]
          : [m.player_a1_id, m.player_a2_id];

        for (const pid of winnerPids) {
          if (pid) { ensure(pid); map.get(pid)!.wins++; }
        }
        for (const pid of loserPids) {
          if (pid) { ensure(pid); map.get(pid)!.losses++; }
        }
      }
    }
  }

  // Sort: wins desc, then points_against asc (tiebreaker)
  const rows = [...map.entries()].map(([id, s]) => ({
    id,
    wins: s.wins,
    losses: s.losses,
    pointsFor: s.pf,
    pointsAgainst: s.pa,
    rank: 0,
  }));

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    // Tiebreaker: fewer points against is better
    return a.pointsAgainst - b.pointsAgainst;
  });

  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * Par Match seeding: 1st vs last, 2nd vs 2nd-last, etc.
 */
export function buildParMatchBracket(
  rankedIds: string[]
): Array<[string, string]> {
  const n = rankedIds.length;
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < Math.floor(n / 2); i++) {
    pairs.push([rankedIds[i], rankedIds[n - 1 - i]]);
  }
  return pairs;
}
