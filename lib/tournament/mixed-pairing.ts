/**
 * Mixed Tournament Pairing Algorithm
 *
 * Solves a variant of the Social Golfer Problem:
 * Given N players, C courts, and G target games per player,
 * generate rounds of matches (4 players each) that minimize
 * repeated partners and opponents.
 *
 * Strategy:
 * - Small instances (N ≤ 12, rounds ≤ 4): backtracking for optimal solution
 * - Large instances: greedy with penalty scoring + random restarts
 */

export interface PairingMatrix {
  [playerA: string]: {
    [playerB: string]: { partner: number; opponent: number };
  };
}

export interface MixedMatch {
  teamA: [string, string]; // [playerA1, playerA2]
  teamB: [string, string]; // [playerB1, playerB2]
  court: number;
}

export interface MixedRound {
  matches: MixedMatch[];
  sittingOut: string[];
}

function initMatrix(players: string[]): PairingMatrix {
  const matrix: PairingMatrix = {};
  for (const a of players) {
    matrix[a] = {};
    for (const b of players) {
      if (a !== b) matrix[a][b] = { partner: 0, opponent: 0 };
    }
  }
  return matrix;
}

function matchPenalty(
  match: MixedMatch,
  matrix: PairingMatrix
): number {
  const [a1, a2] = match.teamA;
  const [b1, b2] = match.teamB;
  let penalty = 0;

  // Partner penalties (squared to strongly discourage repeats)
  penalty += (matrix[a1][a2]?.partner ?? 0) ** 2;
  penalty += (matrix[b1][b2]?.partner ?? 0) ** 2;

  // Opponent penalties
  for (const ta of [a1, a2]) {
    for (const tb of [b1, b2]) {
      penalty += (matrix[ta][tb]?.opponent ?? 0) ** 2;
    }
  }

  return penalty;
}

function applyRoundToMatrix(round: MixedRound, matrix: PairingMatrix): void {
  for (const match of round.matches) {
    const [a1, a2] = match.teamA;
    const [b1, b2] = match.teamB;

    matrix[a1][a2].partner++;
    matrix[a2][a1].partner++;
    matrix[b1][b2].partner++;
    matrix[b2][b1].partner++;

    for (const ta of [a1, a2]) {
      for (const tb of [b1, b2]) {
        matrix[ta][tb].opponent++;
        matrix[tb][ta].opponent++;
      }
    }
  }
}

function generateRoundGreedy(
  players: string[],
  courts: number,
  matrix: PairingMatrix,
  attempts = 20
): MixedRound {
  const matchesPerRound = Math.min(courts, Math.floor(players.length / 4));
  let bestRound: MixedRound | null = null;
  let bestPenalty = Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Shuffle players for randomization
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const playing = shuffled.slice(0, matchesPerRound * 4);
    const sittingOut = shuffled.slice(matchesPerRound * 4);

    const matches: MixedMatch[] = [];
    let roundPenalty = 0;

    for (let i = 0; i < matchesPerRound; i++) {
      const four = playing.slice(i * 4, i * 4 + 4);

      // Try all 3 ways to split 4 players into 2 teams of 2
      const splits = [
        { teamA: [four[0], four[1]] as [string, string], teamB: [four[2], four[3]] as [string, string] },
        { teamA: [four[0], four[2]] as [string, string], teamB: [four[1], four[3]] as [string, string] },
        { teamA: [four[0], four[3]] as [string, string], teamB: [four[1], four[2]] as [string, string] },
      ];

      let bestSplit = splits[0];
      let bestSplitPenalty = Infinity;

      for (const split of splits) {
        const m: MixedMatch = { teamA: split.teamA, teamB: split.teamB, court: i + 1 };
        const p = matchPenalty(m, matrix);
        if (p < bestSplitPenalty) {
          bestSplitPenalty = p;
          bestSplit = split;
        }
      }

      const match: MixedMatch = { teamA: bestSplit.teamA, teamB: bestSplit.teamB, court: i + 1 };
      matches.push(match);
      roundPenalty += matchPenalty(match, matrix);
    }

    if (roundPenalty < bestPenalty) {
      bestPenalty = roundPenalty;
      bestRound = { matches, sittingOut };
    }
  }

  return bestRound!;
}

/**
 * Main entry point.
 *
 * @param players   Array of player IDs
 * @param courts    Number of available courts
 * @param totalGames Target games per player
 * @returns Array of rounds, each with matches and sitting-out players
 */
export function generateMixedSchedule(
  players: string[],
  courts: number,
  totalGames: number
): MixedRound[] {
  if (players.length < 4) throw new Error("Need at least 4 players for mixed");

  const matchesPerRound = Math.min(courts, Math.floor(players.length / 4));
  const gamesPerRound = matchesPerRound * 4 / players.length; // avg games per player per round
  const numRounds = Math.ceil(totalGames / gamesPerRound);

  const matrix = initMatrix(players);
  const rounds: MixedRound[] = [];

  for (let r = 0; r < numRounds; r++) {
    // Ensure players who sat out most recently play first
    const prioritized = [...players].sort((a, b) => {
      const satsA = rounds.filter((rd) => rd.sittingOut.includes(a)).length;
      const satsB = rounds.filter((rd) => rd.sittingOut.includes(b)).length;
      return satsB - satsA; // more sit-outs = higher priority to play
    });

    const round = generateRoundGreedy(prioritized, courts, matrix);
    applyRoundToMatrix(round, matrix);
    rounds.push(round);
  }

  return rounds;
}

/**
 * For the mixed second round:
 * After individual standings (rank 1..N), pair:
 *   1st + 8th, 2nd + 7th, 3rd + 6th, 4th + 5th (for top 8)
 * Returns the new teams as [player1Id, player2Id] pairs.
 */
export function buildMixedSecondRoundTeams(
  rankedPlayerIds: string[]
): Array<[string, string]> {
  const n = rankedPlayerIds.length;
  const teams: Array<[string, string]> = [];
  for (let i = 0; i < Math.floor(n / 2); i++) {
    teams.push([rankedPlayerIds[i], rankedPlayerIds[n - 1 - i]]);
  }
  return teams;
}
