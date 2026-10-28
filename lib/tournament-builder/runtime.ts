import type { TournamentDefinition } from './definition';
import { computeStandings } from './policies';
import { assertValidRoster, type FixtureResult, type RuntimeOptions, type TournamentAnalysis, type TournamentEntry } from './types';
import { generateRoundRobin } from './modules/round-robin';
import { generateElimination, resolveBracket } from './modules/elimination';
import { computePlacements } from './modules/placements';

/** Analyze a locked roster under a validated immutable definition. No DB writes, timers or randomness.
 * Inputs contain current non-void results only. Callers bind draw revisions and fixture IDs to this event.
 * Court waves are a plan; transactional start commands must enforce real occupancy.
 */
export function analyzeTournament(definition: TournamentDefinition, entries: readonly TournamentEntry[], results: readonly FixtureResult[], options: RuntimeOptions = {}): TournamentAnalysis {
  const analysis: TournamentAnalysis = { state: 'waiting', fixtures: [], standings: [], ties: [], qualifiers: [] };
  function checked(output = analysis): TournamentAnalysis {
    const ids = new Set(analysis.fixtures.map(f => f.id));
    if (results.some(r => !ids.has(r.fixtureId)) || new Set(results.map(r => r.fixtureId)).size !== results.length) throw new Error('Results must reference unique current fixtures in this event.');
    return output;
  }
  const block = (blockedCode: TournamentAnalysis['blockedCode']) => checked({ ...analysis, state: 'blocked', blockedCode });
  const d = definition;
  if (entries.length < d.registration.min_entries || entries.length > d.registration.max_entries || entries.some(e => e.playerIds.length !== (d.registration.entry_type === 'singles' ? 1 : 2))) return block('INVALID_CAPACITY');
  assertValidRoster(entries, d.event.courts);
  const eligible = options.eligibleEntryIds ?? entries.map(e => e.id);
  if (new Set(eligible).size !== eligible.length || eligible.some(id => !entries.some(e => e.id === id))) throw new Error('Eligible IDs must be unique roster entries.');
  const rr = d.nodes.find(node => node.module === 'round_robin@1');
  const qualifying = d.nodes.find(node => node.module === 'qualify@1');
  const eliminating = d.nodes.find(node => node.module === 'elimination@1');
  let rankedEligible: string[] = [];
  if (rr) {
    const rrFixtures = generateRoundRobin(entries, d.event.courts, rr.id);
    analysis.fixtures.push(...rrFixtures);
    const ids = new Set(rrFixtures.map(f => f.id));
    const current = resolveBracket(rrFixtures, results.filter(r => ids.has(r.fixtureId)), undefined, d.policies.match);
    const standingResults = current.fixtures.flatMap(f => f.result && f.entryA && f.entryB ? [{ a: f.entryA, b: f.entryB, scoreA: f.result.scoreA, scoreB: f.result.scoreB, outcome: f.result.outcome, winner: f.result.winnerEntryId, accepted: true }] : []);
    const ranking = computeStandings(entries.map(e => e.id), standingResults, d.policies.ranking.order, (options.rankingDraws ?? []).filter(draw => draw.inputRevision === (options.inputRevision ?? 0)).map(draw => draw.entryIds), options.roundRobinExclusions);
    analysis.standings = ranking.rows;
    analysis.ties = ranking.ties.map(group => group.filter(id => eligible.includes(id))).filter(group => group.length > 1);
    rankedEligible = ranking.rows.filter(row => eligible.includes(row.entryId)).map(row => row.entryId);
    if (current.state !== 'completed') return checked();
    if (qualifying?.module === 'qualify@1') {
      const count = qualifying.config.count;
      if (options.playoffsStarted || options.lockedQualifierIds) {
        const pinned = options.lockedQualifierIds;
        if (!pinned || pinned.length !== count || new Set(pinned).size !== count || pinned.some(id => !entries.some(e => e.id === id))) return block('INVALID_ADVANCEMENT');
        analysis.qualifiers = [...pinned];
      } else {
        if (rankedEligible.length < count) return block('INVALID_ADVANCEMENT');
        analysis.qualifiers = rankedEligible.slice(0, count);
        if (analysis.ties.some(group => group.some(id => analysis.qualifiers.includes(id)))) { analysis.qualifiers = []; return block('UNRESOLVED_TIE'); }
      }
    } else {
      if (!rankedEligible.length) return block('NO_ELIGIBLE_CHAMPION');
      if (analysis.ties.length) return block('UNRESOLVED_TIE');
      const ineligibleEntryIds = entries.filter(e => !eligible.includes(e.id)).map(e => e.id);
      analysis.placements = { state: 'completed', championEntryId: rankedEligible[0], groups: rankedEligible.map((id, i) => ({ rank: i + 1, entryIds: [id] })), ineligibleEntryIds, unplacedEntryIds: ineligibleEntryIds };
      analysis.state = 'completed';
    }
  }
  if (eliminating?.module === 'elimination@1') {
    let bracketEntries: TournamentEntry[];
    if (qualifying) bracketEntries = analysis.qualifiers.map(id => entries.find(e => e.id === id)!);
    else {
      const draw = options.directDraw;
      if (!draw || draw.rosterRevision !== (options.rosterRevision ?? 0) || draw.entryIds.length !== entries.length || new Set(draw.entryIds).size !== entries.length || !entries.every(e => draw.entryIds.includes(e.id))) return block('DRAW_REQUIRED');
      bracketEntries = draw.entryIds.map(id => entries.find(e => e.id === id)!);
    }
    if (![2, 4, 8, 16].includes(bracketEntries.length) || (eliminating.config.bronze && bracketEntries.length === 2)) return block('INVALID_CAPACITY');
    const offset = Math.max(0, ...analysis.fixtures.map(f => f.wave));
    const fixtures = generateElimination(bracketEntries, d.event.courts, { ...eliminating.config, stageId: eliminating.id }).map(f => ({ ...f, wave: f.wave + offset }));
    analysis.fixtures.push(...fixtures);
    const ids = new Set(fixtures.map(f => f.id));
    analysis.bracket = resolveBracket(fixtures, results.filter(r => ids.has(r.fixtureId)), eligible, d.policies.match);
    analysis.placements = computePlacements(analysis.bracket, rankedEligible.filter(id => !analysis.qualifiers.includes(id)));
    if (analysis.placements.state === 'completed' && analysis.ties.length) { analysis.placements = { state: 'blocked', blockedCode: 'UNRESOLVED_TIE' }; return block('UNRESOLVED_TIE'); }
    if (analysis.placements.state === 'completed') {
      const placed = new Set(analysis.placements.groups!.flatMap(g => g.entryIds));
      analysis.placements.ineligibleEntryIds = entries.filter(e => !eligible.includes(e.id)).map(e => e.id);
      analysis.placements.unplacedEntryIds = entries.filter(e => !placed.has(e.id)).map(e => e.id);
    }
    analysis.state = analysis.placements.state;
    analysis.blockedCode = analysis.placements.blockedCode;
  }
  return checked();
}
