import type { Fixture, ResolvedFixture, TournamentEntry } from './types';

export interface SchedulingBlock {
  id: string;
  dependencies: string[];
  fixtures: Fixture[];
  /** All possible players, independent of accepted results, indexed by fixture ID. */
  players: Map<string, string[]>;
}

/** Assign estimates in place; never change pairings, IDs or logical rounds.
 * Round-robin rounds label pairings; only graph dependencies impose barriers.
 * Rest is a preference among available games, not a reason to leave a court idle.
 */
export function scheduleFairly(blocks: readonly SchedulingBlock[], courts: number, preferredRestSlots = 0): void {
  const pending = new Set(blocks.flatMap(block => block.fixtures));
  const last = new Map<string, number>(), games = new Map<string, number>(), streak = new Map<string, number>();
  const completed = new Set<string>();
  let wave = 1;
  while (pending.size) {
    const ready = blocks.filter(block => block.dependencies.every(id => completed.has(id))).flatMap(block => {
      const remaining = block.fixtures.filter(f => pending.has(f));
      return remaining.map(fixture => ({ fixture, players: block.players.get(fixture.id)! }));
    });
    const busy = new Set<string>();
    let assigned = 0;
    for (let court = 1; court <= courts; court++) {
      const candidates = ready.filter(item => pending.has(item.fixture) && item.players.every(player => !busy.has(player)));
      // Oldest waiting player first; then avoid repeated consecutive play and
      // prefer less-played participants. Original fixture order breaks exact ties.
      const priority = (players: string[]) => [
        Math.max(0, ...players.map(p => wave - (last.get(p) ?? 0) - 1)),
        -players.reduce((sum, p) => sum + (wave - (last.get(p) ?? -Infinity) - 1 < preferredRestSlots ? 1 : 0), 0),
        -Math.max(0, ...players.map(p => last.get(p) === wave - 1 ? streak.get(p) ?? 0 : 0)),
        -players.reduce((sum, p) => sum + (games.get(p) ?? 0), 0) / Math.max(1, players.length),
      ];
      candidates.sort((a, b) => {
        const left = priority(a.players), right = priority(b.players);
        for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return right[i] - left[i];
        return 0;
      });
      const next = candidates[0];
      if (!next) break;
      next.fixture.wave = wave; next.fixture.court = court;
      pending.delete(next.fixture); assigned++;
      for (const player of next.players) {
        busy.add(player);
        streak.set(player, last.get(player) === wave - 1 ? (streak.get(player) ?? 0) + 1 : 1);
        last.set(player, wave); games.set(player, (games.get(player) ?? 0) + 1);
      }
    }
    if (!assigned) throw new Error('Scheduling dependencies cannot be resolved.');
    blocks.filter(block => block.fixtures.every(f => !pending.has(f))).forEach(block => completed.add(block.id));
    wave++;
  }
}

export interface EntryFairness {
  entryId: string;
  games: number;
  idleSlots: number;
  longestWait: number;
  longestConsecutivePlay: number;
}

/** Summarize planned slots for concrete two-sided matches only. Unresolved ports
 * and walkovers do not count as games. Waiting excludes time before/after play.
 * Unequal groups and dependencies can make equal waits impossible.
 */
export function summarizeScheduleFairness(entries: readonly TournamentEntry[], fixtures: readonly ResolvedFixture[]): EntryFairness[] {
  return entries.map(entry => {
    const waves = fixtures.filter(f => f.entryA && f.entryB && (f.entryA === entry.id || f.entryB === entry.id) && (!f.result || f.result.outcome === 'played')).map(f => f.fixture.wave).sort((a, b) => a - b);
    let longestWait = 0, longestConsecutivePlay = waves.length ? 1 : 0, streak = longestConsecutivePlay;
    for (let i = 1; i < waves.length; i++) {
      longestWait = Math.max(longestWait, waves[i] - waves[i - 1] - 1);
      streak = waves[i] === waves[i - 1] + 1 ? streak + 1 : 1;
      longestConsecutivePlay = Math.max(longestConsecutivePlay, streak);
    }
    return { entryId: entry.id, games: waves.length, idleSlots: waves.length ? waves.at(-1)! - waves[0] + 1 - waves.length : 0, longestWait, longestConsecutivePlay };
  });
}
