import { isLegalScore } from '../policies';
import { assertValidRoster, type BracketResolution, type Fixture, type FixtureResult, type FixtureSlot, type ResolvedFixture, type TournamentEntry } from '../types';

/** Entries are already in ranked order or the persisted draw order. This function never shuffles. */
export function generateElimination(entries: readonly TournamentEntry[], courts: number, options: { seeding: 'draw' | 'ranked'; bronze: boolean; stageId?: string }): Fixture[] {
  assertValidRoster(entries, courts);
  if (![2, 4, 8, 16].includes(entries.length) || (options.bronze && entries.length === 2)) throw new Error('Unsupported bracket size or two-entry bronze.');
  const stageId = options.stageId ?? 'elimination';
  let seeds = [1, 2];
  for (let size = 4; size <= entries.length; size *= 2) seeds = seeds.flatMap(seed => [seed, size + 1 - seed]);
  let slots: FixtureSlot[] = seeds.map(seed => ({ kind: 'entry', entryId: entries[seed - 1].id }));
  const fixtures: Fixture[] = [];
  let wave = 1, round = 1;
  let semifinalIds: string[] = [];
  while (slots.length > 1) {
    const current: Fixture[] = [];
    for (let i = 0; i < slots.length / 2; i++) current.push({ id: `${stageId}:r${round}:m${i + 1}`, stageId, round, wave: wave + Math.floor(i / courts), court: i % courts + 1, a: slots[i * 2], b: slots[i * 2 + 1] });
    if (current.length === 2) semifinalIds = current.map(f => f.id);
    fixtures.push(...current);
    slots = current.map(f => ({ kind: 'winner', fixtureId: f.id }));
    wave += Math.ceil(current.length / courts);
    round++;
  }
  if (options.bronze) {
    const final = fixtures.at(-1)!;
    fixtures.push({ id: `${stageId}:bronze`, stageId, round: final.round, wave: final.wave + (courts === 1 ? 1 : 0), court: courts === 1 ? 1 : 2, a: { kind: 'loser', fixtureId: semifinalIds[0] }, b: { kind: 'loser', fixtureId: semifinalIds[1] }, bronze: true });
  }
  return fixtures;
}

/** Resolve accepted outcomes only. Empty feeder slots request an audited outcome; they never invent one. */
export function resolveBracket(fixtures: readonly Fixture[], results: readonly FixtureResult[], eligibleEntryIds?: readonly string[], scorePolicy = { target: 11, win_by: 2 }): BracketResolution {
  const ids = new Set(fixtures.map(f => f.id));
  if (ids.size !== fixtures.length) throw new Error('Fixture IDs must be unique.');
  const byResult = new Map<string, FixtureResult>();
  for (const result of results) {
    if (!ids.has(result.fixtureId) || byResult.has(result.fixtureId)) throw new Error('Unknown or duplicate current fixture result.');
    byResult.set(result.fixtureId, result);
  }
  const initialIds = [...new Set(fixtures.flatMap(f => [f.a, f.b].flatMap(slot => slot.kind === 'entry' ? [slot.entryId] : [])))];
  const eligible = new Set(eligibleEntryIds ?? initialIds);
  const resolved = new Map<string, ResolvedFixture>();
  const ordered = [...fixtures].sort((a, b) => a.round - b.round);
  function value(slot: FixtureSlot, fixture: Fixture): string | null | undefined {
    if (slot.kind === 'entry') return slot.entryId;
    const feeder = resolved.get(slot.fixtureId);
    if (!feeder || feeder.fixture.stageId !== fixture.stageId || feeder.fixture.round >= fixture.round) throw new Error('Feeder must be an earlier fixture in the same stage.');
    if (feeder.state !== 'completed') return undefined;
    const id = slot.kind === 'winner' ? feeder.winnerEntryId : feeder.loserEntryId;
    return id ?? null;
  }
  for (const fixture of ordered) {
    const result = byResult.get(fixture.id);
    const available = (id: string | null | undefined) => id === undefined ? undefined : id && eligible.has(id) ? id : null;
    const rawA = value(fixture.a, fixture), rawB = value(fixture.b, fixture);
    // Accepted historical participation remains a fact after withdrawal; only unplayed slots lose eligibility.
    const entryA = result?.accepted ? rawA : available(rawA), entryB = result?.accepted ? rawB : available(rawB);
    const ready = entryA !== undefined && entryB !== undefined;
    const current: ResolvedFixture = { fixture, entryA, entryB, state: ready ? 'ready' : 'waiting' };
    if (ready && (!entryA || !entryB)) current.requiredOutcome = !entryA && !entryB ? 'no_contest' : 'walkover';
    if (result?.accepted) {
      if (!ready) throw new Error('Accepted outcome cannot precede accepted feeder outcomes.');
      const winner = result.winnerEntryId ?? null;
      if (result.outcome === 'no_contest') {
        if (winner !== null) throw new Error('No-contest cannot have a winner.');
      } else {
        if (!winner || (winner !== entryA && winner !== entryB)) throw new Error('Winner must be a participating entry.');
        if (result.outcome === 'played') {
          if (!entryA || !entryB || !isLegalScore(result.scoreA!, result.scoreB!, scorePolicy)) throw new Error('Accepted played score is illegal.');
          if (winner !== (result.scoreA! > result.scoreB! ? entryA : entryB)) throw new Error('Winner disagrees with accepted score.');
        }
      }
      current.state = 'completed'; current.result = result; current.winnerEntryId = winner;
      current.loserEntryId = winner ? (winner === entryA ? entryB : entryA) ?? null : null;
    }
    resolved.set(fixture.id, current);
  }
  const output = fixtures.map(f => resolved.get(f.id)!);
  return { state: output.length > 0 && output.every(f => f.state === 'completed') ? 'completed' : output.some(f => f.state === 'ready') ? 'ready' : 'waiting', fixtures: output, eligibleEntryIds: [...eligible] };
}
