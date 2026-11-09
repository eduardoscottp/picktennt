import type { Match, Round } from "@/types/database";
import { isLegacyMatchComplete, legacyWinnerSide, legacyMatchPlayerIds } from "./match-result";

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

/** Preserve completed results, but withdrawn entities never retain a qualifying rank. */
export function rankExitedLast(rows: StandingRow[], exitedIds: Set<string>): StandingRow[] {
  const ranked = rows.map(row => ({ ...row }));
  if (!exitedIds.size) return ranked;
  for (const id of exitedIds) {
    if (!ranked.some(row => row.id === id)) ranked.push({ id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, pointsForInLosses: 0, rank: 0 });
  }
  ranked.sort((a, b) => Number(exitedIds.has(a.id)) - Number(exitedIds.has(b.id)) || a.rank - b.rank);
  ranked.forEach((row, i) => { row.rank = i + 1; });
  return ranked;
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
  return standingsForSides(matches, (m, side) => entityKey === "team"
    ? [side === "a" ? m.team_a_id : m.team_b_id].filter((id): id is string => !!id)
    : [side === "a" ? m.player_a1_id : m.player_b1_id, side === "a" ? m.player_a2_id : m.player_b2_id].filter((id): id is string => !!id),
  nullifiedEntityIds, entityKey === "team");
}

/** Credit the players who played each match, falling back only for older unsnapshotted games. */
export function computeIndividualStandingsFromTeams(
  matches: Match[],
  teamToMembers: Map<string, string[]>,
  nullifiedEntityIds?: Set<string>
): StandingRow[] {
  return standingsForSides(matches, (m, side) => legacyMatchPlayerIds(m, side, teamToMembers), nullifiedEntityIds, true);
}

function standingsForSides(
  matches: Match[],
  idsForSide: (match: Match, side: "a" | "b") => string[],
  nullifiedEntityIds: Set<string> | undefined,
  countDraws: boolean
): StandingRow[] {
  const map = new Map<string, StandingData>();
  for (const match of matches) {
    if (!isLegacyMatchComplete(match) || match.outcome_kind === "no_contest") continue;
    const sides = { a: idsForSide(match, "a"), b: idsForSide(match, "b") };
    if (!sides.a.length || !sides.b.length) continue;
    if ([...sides.a, ...sides.b].some(id => nullifiedEntityIds?.has(id))) continue;
    const winner = legacyWinnerSide(match);
    const hasScore = match.score_a != null && match.score_b != null;
    // Old ambiguous walkovers/retirements cannot safely be assigned to either side.
    if (!winner && (!hasScore || match.outcome_kind === "retirement")) continue;
    for (const side of ["a", "b"] as const) {
      const scored = hasScore ? (side === "a" ? match.score_a! : match.score_b!) : 0;
      const conceded = hasScore ? (side === "a" ? match.score_b! : match.score_a!) : 0;
      for (const id of sides[side]) {
        if (!map.has(id)) map.set(id, { wins: 0, losses: 0, pf: 0, pa: 0, pfInLosses: 0 });
        const row = map.get(id)!;
        row.pf += scored;
        row.pa += conceded;
        if (winner === side) row.wins++;
        else if (winner) { row.losses++; row.pfInLosses += scored; }
        else if (countDraws) row.wins += 0.5;
      }
    }
  }
  const rows = [...map.entries()].map(([id, s]) => ({
    id, wins: s.wins, losses: s.losses, pointsFor: s.pf, pointsAgainst: s.pa,
    pointsForInLosses: s.pfInLosses, rank: 0,
  }));
  rows.sort((a, b) => b.wins - a.wins || a.pointsAgainst - b.pointsAgainst || b.pointsForInLosses - a.pointsForInLosses);
  rows.forEach((row, i) => { row.rank = i + 1; });
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
    const winner = legacyWinnerSide(m);
    if (!a || !b || !winner) return null;
    return winner === "a" ? [a, b] : [b, a];
  }

  // Gold and bronze finals
  for (const m of bracketMatches) {
    if (!isLegacyMatchComplete(m)) continue;
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
      if (!isLegacyMatchComplete(m)) return false;
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
