import type { Match, Round } from "@/types/database";

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
  entityKey: "team" | "player",
  nullifiedEntityIds?: Set<string>
): StandingRow[] {
  const validated = matches.filter((m) => {
    if (m.status !== "validated") return false;
    if (!nullifiedEntityIds?.size) return true;
    if (entityKey === "team") {
      if (m.team_a_id && nullifiedEntityIds.has(m.team_a_id)) return false;
      if (m.team_b_id && nullifiedEntityIds.has(m.team_b_id)) return false;
    } else {
      for (const id of [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id]) {
        if (id && nullifiedEntityIds.has(id)) return false;
      }
    }
    return true;
  });
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
 * Compute individual player standings from team-based (doubles) matches.
 * Each player inherits their team's stats for every match.
 */
export function computeIndividualStandingsFromTeams(
  matches: Match[],
  teamToMembers: Map<string, string[]>,
  nullifiedEntityIds?: Set<string>
): StandingRow[] {
  const validated = matches.filter((m) => {
    if (m.status !== "validated") return false;
    if (!nullifiedEntityIds?.size) return true;
    const membersA = teamToMembers.get(m.team_a_id ?? "") ?? [];
    const membersB = teamToMembers.get(m.team_b_id ?? "") ?? [];
    if (membersA.some((id) => nullifiedEntityIds.has(id))) return false;
    if (membersB.some((id) => nullifiedEntityIds.has(id))) return false;
    return true;
  });
  const map = new Map<string, StandingData>();

  function ensure(id: string) {
    if (!map.has(id)) map.set(id, { wins: 0, losses: 0, pf: 0, pa: 0, pfInLosses: 0 });
  }

  for (const m of validated) {
    if (!m.team_a_id || !m.team_b_id || m.score_a == null || m.score_b == null) continue;
    const membersA = teamToMembers.get(m.team_a_id) ?? [];
    const membersB = teamToMembers.get(m.team_b_id) ?? [];

    for (const pid of membersA) { ensure(pid); map.get(pid)!.pf += m.score_a!; map.get(pid)!.pa += m.score_b!; }
    for (const pid of membersB) { ensure(pid); map.get(pid)!.pf += m.score_b!; map.get(pid)!.pa += m.score_a!; }

    if (m.score_a > m.score_b) {
      for (const pid of membersA) { map.get(pid)!.wins++; }
      for (const pid of membersB) { map.get(pid)!.losses++; map.get(pid)!.pfInLosses += m.score_b!; }
    } else if (m.score_b > m.score_a) {
      for (const pid of membersB) { map.get(pid)!.wins++; }
      for (const pid of membersA) { map.get(pid)!.losses++; map.get(pid)!.pfInLosses += m.score_a!; }
    } else {
      for (const pid of [...membersA, ...membersB]) { map.get(pid)!.wins += 0.5; }
    }
  }

  const rows = [...map.entries()].map(([id, s]) => ({
    id, wins: s.wins, losses: s.losses,
    pointsFor: s.pf, pointsAgainst: s.pa,
    pointsForInLosses: s.pfInLosses, rank: 0,
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
 * Given validated bracket matches and their round types, returns entity_id → final position
 * for entities with a determined bracket result.
 * entityKey "team" → uses team_a_id/team_b_id; "player" → uses player_a1_id/player_b1_id.
 * rrRows is used to sort losers within the same elimination round by their RR seed.
 */
export function computeBracketFinishPositions(
  bracketMatches: Match[],
  rounds: Pick<Round, "id" | "round_type" | "round_number">[],
  entityKey: "team" | "player",
  rrRows: StandingRow[]
): Map<string, number> {
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const rrRankById = new Map(rrRows.map((r) => [r.id, r.rank]));
  const positions = new Map<string, number>();

  function entities(m: Match): [string | null, string | null] {
    return entityKey === "team"
      ? [m.team_a_id, m.team_b_id]
      : [m.player_a1_id, m.player_b1_id];
  }

  function winnerLoser(m: Match): [string, string] | null {
    const [a, b] = entities(m);
    if (!a || !b || m.score_a == null || m.score_b == null) return null;
    return m.score_a >= m.score_b ? [a, b] : [b, a];
  }

  // Gold and bronze finals
  for (const m of bracketMatches) {
    if (m.status !== "validated") continue;
    const round = roundById.get(m.round_id);
    if (!round) continue;
    const wl = winnerLoser(m);
    if (!wl) continue;
    const [winner, loser] = wl;
    if (round.round_type === "finals_gold") {
      positions.set(winner, 1);
      positions.set(loser, 2);
    } else if (round.round_type === "finals_bronze") {
      positions.set(winner, 3);
      positions.set(loser, 4);
    }
  }

  // Permanently-eliminated losers (elimination rounds where losers don't go to bronze)
  const elimLosers = bracketMatches
    .filter((m) => {
      if (m.status !== "validated") return false;
      const round = roundById.get(m.round_id);
      return round?.round_type === "elimination" && m.bracket_next_loser_match_id === null;
    });

  // Group by round_id, sort groups by round_number descending (QF before R16 = higher positions first)
  const byRound = new Map<string, { roundNumber: number; losers: string[] }>();
  for (const m of elimLosers) {
    const round = roundById.get(m.round_id)!;
    const wl = winnerLoser(m);
    if (!wl) continue;
    const loser = wl[1];
    if (!byRound.has(m.round_id)) {
      byRound.set(m.round_id, { roundNumber: round.round_number, losers: [] });
    }
    byRound.get(m.round_id)!.losers.push(loser);
  }

  const sortedGroups = [...byRound.values()].sort((a, b) => b.roundNumber - a.roundNumber);

  let basePosition = 5; // positions 1-4 already assigned from gold/bronze
  for (const group of sortedGroups) {
    // Sort within the group by RR rank ascending (better seed = better sub-rank)
    group.losers.sort((a, b) => (rrRankById.get(a) ?? 999) - (rrRankById.get(b) ?? 999));
    group.losers.forEach((id, idx) => positions.set(id, basePosition + idx));
    basePosition += group.losers.length;
  }

  return positions;
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
