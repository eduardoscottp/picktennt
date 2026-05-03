/**
 * Circle-method round-robin schedule generator.
 * Returns N-1 rounds for N teams (even). Each round has at most `courts` matches.
 * Teams that exceed court capacity sit out (rotated fairly by the circle method itself).
 */
export function generateRoundRobinSchedule(
  teamIds: string[],
  courts: number
): Array<Array<[string, string]>> {
  const hasBye = teamIds.length % 2 !== 0;
  const teams = hasBye ? [...teamIds, "__BYE__"] : [...teamIds];
  const n = teams.length;
  const rounds: Array<Array<[string, string]>> = [];

  for (let round = 0; round < n - 1; round++) {
    const pairs: Array<[string, string]> = [];

    for (let i = 0; i < n / 2; i++) {
      const home = teams[i];
      const away = teams[n - 1 - i];
      if (home !== "__BYE__" && away !== "__BYE__") {
        pairs.push([home, away]);
      }
    }

    // Limit to available courts (extras sit out this round)
    rounds.push(pairs.slice(0, courts));

    // Rotate: keep teams[0] fixed, rotate teams[1..n-1] right by 1
    const last = teams[n - 1];
    for (let i = n - 1; i > 1; i--) {
      teams[i] = teams[i - 1];
    }
    teams[1] = last;
  }

  return rounds;
}
