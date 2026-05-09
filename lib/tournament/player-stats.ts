type MatchSide = "a" | "b";

type TeamMember = { user_id: string | null };
type TeamWithMembers = { team_members?: TeamMember[] | null } | null;

export interface PlayerStatsMatch {
  player_a1_id?: string | null;
  player_a2_id?: string | null;
  player_b1_id?: string | null;
  player_b2_id?: string | null;
  score_a?: number | null;
  score_b?: number | null;
  team_a?: TeamWithMembers;
  team_b?: TeamWithMembers;
}

function teamIncludesUser(team: TeamWithMembers, userId: string): boolean {
  return (team?.team_members ?? []).some((member) => member.user_id === userId);
}

export function isUserOnMatchSide(match: PlayerStatsMatch, userId: string, side: MatchSide): boolean {
  if (side === "a") {
    return match.player_a1_id === userId
      || match.player_a2_id === userId
      || teamIncludesUser(match.team_a ?? null, userId);
  }

  return match.player_b1_id === userId
    || match.player_b2_id === userId
    || teamIncludesUser(match.team_b ?? null, userId);
}

export function computeValidatedPlayerStats(matches: PlayerStatsMatch[], userId: string) {
  const participatingMatches = matches.filter(
    (match) => isUserOnMatchSide(match, userId, "a") || isUserOnMatchSide(match, userId, "b")
  );

  const wins = participatingMatches.filter((match) => {
    const scoreA = match.score_a ?? 0;
    const scoreB = match.score_b ?? 0;
    if (scoreA === scoreB) return false;

    const userOnA = isUserOnMatchSide(match, userId, "a");
    const userOnB = isUserOnMatchSide(match, userId, "b");

    return (userOnA && scoreA > scoreB) || (userOnB && scoreB > scoreA);
  }).length;

  return {
    matches: participatingMatches.length,
    wins,
  };
}
