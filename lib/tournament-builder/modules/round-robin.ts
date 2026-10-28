import { assertValidRoster, type Fixture, type TournamentEntry } from '../types';

/** Circle scheduling; odd-count byes never become fixtures. Waves are estimates, not start permission. */
export function generateRoundRobin(entries: readonly TournamentEntry[], courts: number, stageId = 'rr'): Fixture[] {
  assertValidRoster(entries, courts);
  const ring: (string | null)[] = entries.map(entry => entry.id);
  if (ring.length % 2) ring.push(null);
  const fixtures: Fixture[] = [];
  let wave = 1;
  for (let round = 1; round < ring.length; round++) {
    let match = 0;
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (a === null || b === null) continue;
      fixtures.push({ id: `${stageId}:r${round}:m${match + 1}`, stageId, round, wave: wave + Math.floor(match / courts), court: match % courts + 1, a: { kind: 'entry', entryId: a }, b: { kind: 'entry', entryId: b } });
      match++;
    }
    wave += Math.ceil(match / courts);
    ring.splice(1, 0, ring.pop()!);
  }
  return fixtures;
}
