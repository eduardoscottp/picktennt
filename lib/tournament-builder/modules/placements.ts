import type { BracketResolution, PlacementGroup, PlacementResult } from '../types';

/** Nonqualifiers must already have complete RR ordering; no seed/ID ordering breaks exit-round ties. */
export function computePlacements(bracket: BracketResolution, nonqualifiers: readonly string[] = []): PlacementResult {
  if (bracket.state !== 'completed') return { state: 'waiting' };
  const competitive = bracket.fixtures.filter(f => !f.fixture.bronze);
  const final = competitive.reduce((a, b) => a.fixture.round > b.fixture.round ? a : b);
  if (!final.winnerEntryId || !bracket.eligibleEntryIds.includes(final.winnerEntryId)) return { state: 'blocked', blockedCode: 'NO_ELIGIBLE_CHAMPION' };
  const groups: PlacementGroup[] = [{ rank: 1, entryIds: [final.winnerEntryId] }];
  if (final.loserEntryId) groups.push({ rank: 2, entryIds: [final.loserEntryId] });
  const bronze = bracket.fixtures.find(f => f.fixture.bronze);
  if (bronze) {
    if (bronze.winnerEntryId) groups.push({ rank: 3, entryIds: [bronze.winnerEntryId] });
    if (bronze.loserEntryId) groups.push({ rank: 4, entryIds: [bronze.loserEntryId] });
  }
  for (let round = final.fixture.round - 1; round >= 1; round--) {
    if (bronze && round === final.fixture.round - 1) continue;
    const losers = competitive.filter(f => f.fixture.round === round).flatMap(f => f.loserEntryId ? [f.loserEntryId] : []);
    if (losers.length) groups.push({ rank: 2 ** (final.fixture.round - round) + 1, entryIds: losers });
  }
  const bracketSize = 2 ** final.fixture.round;
  nonqualifiers.forEach((id, i) => groups.push({ rank: bracketSize + i + 1, entryIds: [id] }));
  const all = [...new Set([...bracket.fixtures.flatMap(f => [f.fixture.a, f.fixture.b].flatMap(slot => slot.kind === 'entry' ? [slot.entryId] : [])), ...nonqualifiers])];
  const placed = new Set(groups.flatMap(group => group.entryIds));
  return { state: 'completed', championEntryId: final.winnerEntryId, groups, ineligibleEntryIds: all.filter(id => !bracket.eligibleEntryIds.includes(id)), unplacedEntryIds: all.filter(id => !placed.has(id)) };
}
