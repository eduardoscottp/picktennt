export interface BracketMatch {
  tempId: string;
  court: number;
  teamAId: string | null;
  teamBId: string | null;
  nextWinnerTempId: string | null;
  nextLoserTempId: string | null;
  winnerFillsSide: "a" | "b" | null;
  loserFillsSide: "a" | "b" | null;
}

export interface BracketRound {
  roundType: "elimination" | "finals_bronze" | "finals_gold";
  matches: BracketMatch[];
}

function gen(): string {
  return typeof crypto !== "undefined"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now();
}

/**
 * Builds a FIFA-style single-elimination bracket for `rankedTeamIds`.
 * The length of rankedTeamIds must be a power of 2 (2, 4, 8, 16...).
 *
 * Seeding: 1st vs last, 2nd vs 2nd-last, etc.
 * SF losers play for 3rd place (when n >= 4).
 * Returns rounds in play order: first elimination round → ... → finals.
 */
export function buildBracket(rankedTeamIds: string[]): BracketRound[] {
  const n = rankedTeamIds.length;
  if (n < 2 || (n & (n - 1)) !== 0)
    throw new Error("Bracket size must be a power of 2 (2, 4, 8, 16…)");

  const finalId = gen();
  const thirdId = n >= 4 ? gen() : null;

  // Number of elimination rounds before the Finals (0 for n=2, 1 for n=4, 2 for n=8…)
  const numElimRounds = Math.log2(n) - 1;

  // Pre-generate all elimination match IDs per round
  // elimIds[0] = first round (n/2 matches), elimIds[last] = SF (2 matches)
  const elimIds: string[][] = [];
  for (let r = 0; r < numElimRounds; r++) {
    const count = n / Math.pow(2, r + 1);
    elimIds.push(Array.from({ length: count }, gen));
  }

  const rounds: BracketRound[] = [];

  // Build elimination rounds
  for (let r = 0; r < numElimRounds; r++) {
    const isSF = r === numElimRounds - 1;
    const ids = elimIds[r];

    const matches: BracketMatch[] = ids.map((id, i) => {
      const isFirst = r === 0;
      const teamAId = isFirst ? rankedTeamIds[i] : null;
      const teamBId = isFirst ? rankedTeamIds[n - 1 - i] : null;

      let nextWinnerTempId: string | null;
      let winnerFillsSide: "a" | "b" | null;
      let nextLoserTempId: string | null = null;
      let loserFillsSide: "a" | "b" | null = null;

      if (isSF) {
        nextWinnerTempId = finalId;
        winnerFillsSide = i === 0 ? "a" : "b";
        nextLoserTempId = thirdId;
        loserFillsSide = i === 0 ? "a" : "b";
      } else {
        const nextIdx = Math.floor(i / 2);
        nextWinnerTempId = elimIds[r + 1][nextIdx];
        winnerFillsSide = i % 2 === 0 ? "a" : "b";
      }

      return { tempId: id, court: i + 1, teamAId, teamBId, nextWinnerTempId, winnerFillsSide, nextLoserTempId, loserFillsSide };
    });

    rounds.push({ roundType: "elimination", matches });
  }

  // For n=2 there are no elim rounds — go straight to Final with real teams
  if (n === 2) {
    rounds.push({
      roundType: "finals_gold",
      matches: [{
        tempId: finalId, court: 1,
        teamAId: rankedTeamIds[0], teamBId: rankedTeamIds[1],
        nextWinnerTempId: null, winnerFillsSide: null,
        nextLoserTempId: null, loserFillsSide: null,
      }],
    });
    return rounds;
  }

  // 3rd place match
  rounds.push({
    roundType: "finals_bronze",
    matches: [{
      tempId: thirdId!, court: 1,
      teamAId: null, teamBId: null,
      nextWinnerTempId: null, winnerFillsSide: null,
      nextLoserTempId: null, loserFillsSide: null,
    }],
  });

  // Final
  rounds.push({
    roundType: "finals_gold",
    matches: [{
      tempId: finalId, court: n >= 4 ? 2 : 1,
      teamAId: null, teamBId: null,
      nextWinnerTempId: null, winnerFillsSide: null,
      nextLoserTempId: null, loserFillsSide: null,
    }],
  });

  return rounds;
}
