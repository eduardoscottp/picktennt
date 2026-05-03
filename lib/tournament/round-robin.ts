/**
 * Circle-method round-robin schedule generator.
 *
 * Each "circle round" produces N/2 pairs. When courts < N/2 we split that
 * circle round into multiple DB rounds so no team ever sits out two consecutive
 * times for the same logical reason, and every team plays the same number of games.
 *
 * Returns an array of DB rounds, each containing at most `courts` pairs.
 * The full schedule gives every team exactly N-1 games (one vs each opponent).
 * Slice to `gamesPerPlayer * Math.ceil(N / (2 * courts))` rounds to limit games.
 */
export function generateRoundRobinSchedule(
  teamIds: string[],
  courts: number
): Array<Array<[string, string]>> {
  const hasBye = teamIds.length % 2 !== 0;
  const teams = hasBye ? [...teamIds, "__BYE__"] : [...teamIds];
  const n = teams.length;
  const dbRounds: Array<Array<[string, string]>> = [];

  for (let round = 0; round < n - 1; round++) {
    // Build all N/2 pairs for this circle-method round
    const circlePairs: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const home = teams[i];
      const away = teams[n - 1 - i];
      if (home !== "__BYE__" && away !== "__BYE__") {
        circlePairs.push([home, away]);
      }
    }

    // Split into DB rounds of `courts` each — no team appears twice in a DB round
    for (let i = 0; i < circlePairs.length; i += courts) {
      dbRounds.push(circlePairs.slice(i, i + courts));
    }

    // Rotate: keep teams[0] fixed, rotate teams[1..n-1] right by 1
    const last = teams[n - 1];
    for (let i = n - 1; i > 1; i--) teams[i] = teams[i - 1];
    teams[1] = last;
  }

  return dbRounds;
}

/**
 * Given the number of teams, courts, and desired games per team,
 * returns how many DB rounds are needed.
 *
 * Each "circle round" = ceil(N/2 / courts) DB rounds, and each team
 * plays exactly 1 game per circle round.
 */
export function roundsNeeded(teamCount: number, courts: number, gamesPerTeam: number): number {
  const n = teamCount % 2 === 0 ? teamCount : teamCount + 1; // account for bye
  const dbRoundsPerCircleRound = Math.ceil((n / 2) / courts);
  return gamesPerTeam * dbRoundsPerCircleRound;
}
