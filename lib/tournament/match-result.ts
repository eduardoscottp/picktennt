import type { Match } from "@/types/database";

export function isLegacyMatchComplete(match: Pick<Match, "status">): boolean {
  return match.status === "validated" || match.status === "walkover";
}

/** Walkovers have no numeric score; retirement can be won by the trailing side. */
export function legacyWinnerSide(match: Match): "a" | "b" | null {
  if (!isLegacyMatchComplete(match) || match.outcome_kind === "no_contest") return null;
  if (match.legacy_winner_side) return match.legacy_winner_side;
  if (match.winner_team_id && match.winner_team_id === match.team_a_id) return "a";
  if (match.winner_team_id && match.winner_team_id === match.team_b_id) return "b";
  if (match.status === "walkover" || match.outcome_kind === "retirement") return null;
  if (match.score_a == null || match.score_b == null || match.score_a === match.score_b) return null;
  return match.score_a > match.score_b ? "a" : "b";
}

export function legacyMatchPlayerIds(match: Match, side: "a" | "b", teamToMembers: Map<string, string[]>): string[] {
  const snapshots = side === "a" ? [match.player_a1_id, match.player_a2_id] : [match.player_b1_id, match.player_b2_id];
  const ids = snapshots.filter((id): id is string => !!id);
  return ids.length ? ids : teamToMembers.get((side === "a" ? match.team_a_id : match.team_b_id) ?? "") ?? [];
}
