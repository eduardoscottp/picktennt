import { scheduleFairly, type SchedulingBlock } from './fair-scheduling';
import { computeStandings } from './policies';
import { generateRoundRobin } from './modules/round-robin';
import { resolveBracket } from './modules/elimination';
import { assertValidRoster, type FixtureResult, type FixtureSlot, type PlacementGroup, type ResolvedFixture, type TournamentEntry } from './types';
import { graphOrder, graphSources, type GraphAnalysis, type GraphDefinition, type GraphRuntimeOptions, type GraphSource } from './graph-types';
import { validateGraph } from './graph-validate';
/** Pure graph replay. Empty entry slots denote unresolved ports, never fabricated roster entries. */
export function analyzeGraph(d: GraphDefinition, entries: readonly TournamentEntry[], results: readonly FixtureResult[], options: GraphRuntimeOptions = {}): GraphAnalysis {
  const invalid = validateGraph(d);
  if (invalid.length)
    throw new Error(invalid.map(i => i.message).join(' '));
  const out: GraphAnalysis = { state: 'waiting', fixtures: [], resolvedFixtures: [], standings: [], ties: [], qualifiers: [], graphStages: {}, fixtureSources: {} };
  const expectedPlayers = d.registration.entry_type === 'singles' ? 1 : 2;
  if (entries.length < d.registration.min_entries || entries.length > d.registration.max_entries || entries.some(e => options.allowIncompleteRoster ? e.playerIds.length > expectedPlayers : e.playerIds.length !== expectedPlayers))
    return { ...out, state: 'blocked', blockedCode: 'INVALID_CAPACITY' };
  assertValidRoster(entries, d.event.courts, options.allowIncompleteRoster);
  if (new Set(results.map(r => r.fixtureId)).size !== results.length)
    throw new Error('Results must reference unique current fixtures.');
  const eligible = options.eligibleEntryIds ?? entries.map(e => e.id);
  if (new Set(eligible).size !== eligible.length || eligible.some(id => !entries.some(e => e.id === id)))
    throw new Error('Eligible IDs must be unique roster entries.');
  for (const [nodeId, override] of Object.entries(options.manualMatchEntries ?? {})) {
    if (!d.nodes.some(node => node.id === nodeId && node.module === 'match@1') || !override || typeof override !== 'object' || Array.isArray(override) || Object.keys(override).some(key => key !== 'a' && key !== 'b') || Object.values(override).some(id => typeof id !== 'string' || !eligible.includes(id)) || (override.a && override.b && override.a === override.b))
      throw new Error('Invalid manual match entries.');
  }
  const seedIds = options.directDraw?.entryIds ?? entries.map(e => e.id);
  const assignments = options.seedAssignments;
  if (assignments && (Object.keys(assignments).some(key => !/^[1-9]\d*$/.test(key) || Number(key) > d.registration.max_entries) || Object.values(assignments).length !== entries.length || new Set(Object.values(assignments)).size !== entries.length || Object.values(assignments).some(id => !entries.some(e => e.id === id)))) throw new Error('Invalid group slot assignments.');
  const seedValue = (seed: number) => assignments ? assignments[seed] ?? null : seedIds[seed - 1] ?? null;
  if (entries.length < d.registration.max_entries && !assignments || d.nodes.some(node => node.module === 'round_robin@2' && node.inputs.every(source => source.kind === 'seed') && node.inputs.filter(source => source.kind === 'seed' && seedValue(source.seed)).length < 2)) return { ...out, state: 'blocked', blockedCode: 'INVALID_CAPACITY' };
  if (seedIds.length !== entries.length || new Set(seedIds).size !== entries.length || seedIds.some(id => !entries.some(e => e.id === id)) || (options.directDraw && options.directDraw.rosterRevision !== (options.rosterRevision ?? 0)))
    throw new Error('Invalid graph seed draw.');
  const completed = new Set<string>(), potentialByNode = new Map<string, Set<string>>();
  const schedulingBlocks: SchedulingBlock[] = [];
  const potential = (s: GraphSource): Set<string> => s.kind === 'seed' ? new Set(seedValue(s.seed) ? [seedValue(s.seed)!] : []) : potentialByNode.get(s.node_id) ?? new Set();
  function sourceValue(s: GraphSource): string | null | undefined {
    if (s.kind === 'seed')
      return seedValue(s.seed);
    const stage = out.graphStages[s.node_id];
    if (!completed.has(s.node_id))
      return undefined;
    if (s.kind === 'rank') {
      const locked = options.lockedRanks?.[s.node_id];
      const id = locked && Object.hasOwn(locked, s.rank) ? locked[s.rank] : (locked ? stage.rows : stage.rows?.filter(row => eligible.includes(row.entryId)))?.[s.rank - 1]?.entryId;
      if (!id)
        return null;
      return !locked && stage.ties?.some(t => t.includes(id) && t.filter(entryId => eligible.includes(entryId)).length > 1) ? undefined : id;
    }
    return (s.kind === 'winner' ? stage.winnerEntryId : stage.loserEntryId) ?? null;
  }
  function slot(s: GraphSource): FixtureSlot {
    if (s.kind === 'winner' || s.kind === 'loser')
      return { kind: s.kind, fixtureId: `${s.node_id}:match` };
    return { kind: 'entry', entryId: sourceValue(s) ?? '' };
  }
  for (const node of graphOrder(d)) {
    if (node.module === 'registration@1' || node.module === 'entries@1') {
      out.graphStages[node.id] = { state: 'completed', entryIds: entries.map(e => e.id) };
      completed.add(node.id);
      continue;
    }
    if (node.module === 'placements@2') {
      const final = out.graphStages[node.final], bronze = node.bronze ? out.graphStages[node.bronze] : undefined;
      if (bronze && final.entryIds.some(id => bronze.entryIds.includes(id))) throw new Error('Placement matches cannot share a team.');
      const allPlayingBlocksComplete = d.nodes.filter(n => graphSources(n).length).every(n => completed.has(n.id));
      if (final.state === 'completed' && (!bronze || bronze.state === 'completed') && allPlayingBlocksComplete) {
        if (!final.winnerEntryId || !eligible.includes(final.winnerEntryId)) {
          out.placements = { state: 'blocked', blockedCode: 'NO_ELIGIBLE_CHAMPION' };
          out.state = 'blocked';
          out.blockedCode = 'NO_ELIGIBLE_CHAMPION';
        }
        else {
          const groups: PlacementGroup[] = [{ rank: 1, entryIds: [final.winnerEntryId] }];
          if (final.loserEntryId && eligible.includes(final.loserEntryId))
            groups.push({ rank: 2, entryIds: [final.loserEntryId] });
          if (bronze) {
            if (bronze.winnerEntryId && eligible.includes(bronze.winnerEntryId))
              groups.push({ rank: 3, entryIds: [bronze.winnerEntryId] });
            if (bronze.loserEntryId && eligible.includes(bronze.loserEntryId))
              groups.push({ rank: 4, entryIds: [bronze.loserEntryId] });
          }
          // Group eliminated entries by distance from the final; unrelated pool ranks are never compared.
          const seen = new Set(groups.flatMap(g => g.entryIds));
          const seenHistory = new Set([final.winnerEntryId, final.loserEntryId, bronze?.winnerEntryId, bronze?.loserEntryId].filter((id): id is string => !!id));
          let frontier = [node.final], rank = bronze ? 5 : 3;
          while (frontier.length) {
            const feeders = frontier.flatMap(id => { const n = d.nodes.find(n => n.id === id); return n?.module === 'match@1' ? n.inputs.flatMap(s => s.kind === 'winner' ? [s.node_id] : []) : []; });
            const historicalLosers = [...new Set(feeders.flatMap(id => { const loser = out.graphStages[id]?.loserEntryId; return loser && !seenHistory.has(loser) ? [loser] : []; }))];
            const ids = historicalLosers.filter(id => eligible.includes(id));
            if (ids.length) {
              groups.push({ rank, entryIds: ids });
              ids.forEach(id => seen.add(id));
            }
            historicalLosers.forEach(id => seenHistory.add(id));
            rank += historicalLosers.length;
            frontier = feeders;
          }
          const rest = entries.filter(e => eligible.includes(e.id) && !seen.has(e.id)).map(e => e.id);
          if (rest.length)
            groups.push({ rank: Math.max(rank, seen.size + 1), entryIds: rest });
          out.placements = { state: 'completed', championEntryId: final.winnerEntryId, groups: groups.sort((a, b) => a.rank - b.rank), ineligibleEntryIds: entries.filter(e => !eligible.includes(e.id)).map(e => e.id), unplacedEntryIds: entries.filter(e => !eligible.includes(e.id)).map(e => e.id) };
          out.state = 'completed';
        }
      }
      else {
        out.state = out.resolvedFixtures.some(f => f.state === 'ready') ? 'ready' : out.ties.length ? 'blocked' : 'waiting';
        if (out.state === 'blocked')
          out.blockedCode = 'UNRESOLVED_TIE';
        out.placements = { state: out.state };
      }
      out.graphStages[node.id] = { state: out.placements!.state, entryIds: out.placements?.groups?.flatMap(g => g.entryIds) ?? [] };
      continue;
    }
    const sources = graphSources(node).filter(source => !(node.module === 'round_robin@2' && source.kind === 'seed' && seedValue(source.seed) === null));
    const override = node.module === 'match@1' ? options.manualMatchEntries?.[node.id] : undefined;
    const manual = [override?.a, override?.b];
    const values = sources.map((source, index) => manual[index] ?? sourceValue(source)), allAvailable = values.every(v => v !== undefined);
    const entryIds = values.filter((v): v is string => typeof v === 'string' && !!v);
    if (new Set(entryIds).size !== entryIds.length)
      throw new Error('Graph block resolves duplicate entries.');
    const possible = (index: number) => manual[index] ? new Set([manual[index]!]) : potential(sources[index]);
    if (override && [...possible(0)].some(id => possible(1).has(id))) throw new Error('Manual match entries may resolve to the same team.');
    potentialByNode.set(node.id, new Set(sources.flatMap((_, index) => [...possible(index)])));
    const tokenEntries = sources.map((_, i) => ({ id: String(i), playerIds: [String(i)] }));
    const generatedRoundRobin = node.module === 'round_robin@2' ? generateRoundRobin(tokenEntries, d.event.courts, node.id) : [];
    const roundRobinTemplate = generatedRoundRobin.map(f => [Number(f.a.kind === 'entry' ? f.a.entryId : 0), Number(f.b.kind === 'entry' ? f.b.entryId : 0)]);
    const crossPairs = node.module === 'cross_play@1' ? node.side_a.flatMap((_, a) => node.side_b.map((__, b) => ({ a, b: node.side_a.length + b, round: (a + b) % Math.max(node.side_a.length, node.side_b.length) + 1 }))).sort((x, y) => x.round - y.round || x.a - y.a) : [];
    const crossTemplate = crossPairs.map(pair => [pair.a, pair.b]);
    const template = node.module === 'match@1' ? [[0, 1]] : node.module === 'cross_play@1' ? crossTemplate : roundRobinTemplate;
    const fixtures = node.module === 'match@1'
      ? [{ id: `${node.id}:match`, stageId: node.id, round: 1, wave: 1, court: 1, a: manual[0] ? { kind: 'entry' as const, entryId: manual[0] } : slot(sources[0]), b: manual[1] ? { kind: 'entry' as const, entryId: manual[1] } : slot(sources[1]) }]
      : node.module === 'cross_play@1'
        ? crossPairs.map((pair, i) => ({ id: `${node.id}:r${pair.round}:m${crossPairs.slice(0, i + 1).filter(item => item.round === pair.round).length}`, stageId: node.id, round: pair.round, wave: 1, court: 1, a: slot(sources[pair.a]), b: slot(sources[pair.b]) }))
        : generatedRoundRobin.map(f => ({ ...f, a: slot(sources[Number(f.a.kind === 'entry' ? f.a.entryId : 0)]), b: slot(sources[Number(f.b.kind === 'entry' ? f.b.entryId : 0)]) }));
    fixtures.forEach((fixture, i) => {
      const source = (index: number) => manual[index] ? { kind: 'entry' as const, entryId: manual[index]! } : sources[index];
      out.fixtureSources[fixture.id] = [source(template[i][0]), source(template[i][1])];
    });
    // Keep possible participants fixed even after results resolve the ports.
    schedulingBlocks.push({
      id: node.id,
      dependencies: [...new Set(sources.flatMap((s, index) => manual[index] || s.kind === 'seed' ? [] : [s.node_id]))],
      fixtures,
      players: new Map(fixtures.map((f, i) => [f.id, [...new Set(template[i].flatMap(index => [...possible(index)]).flatMap(id => [...entries.find(e => e.id === id)!.playerIds, ...(options.allowIncompleteRoster && !entries.find(e => e.id === id)!.playerIds.length ? [`\u0000team:${id}`] : [])]))]])),
    });
    out.fixtures.push(...fixtures);
    const localResults = results.filter(r => fixtures.some(f => f.id === r.fixtureId));
    let resolved: ResolvedFixture[];
    if (!allAvailable) {
      if (localResults.some(r => r.accepted))
        throw new Error('Accepted outcome cannot precede accepted feeder outcomes.');
      resolved = fixtures.map((f, i) => ({ fixture: f, state: 'waiting', entryA: values[template[i][0]], entryB: values[template[i][1]] }));
    }
    else {
      const concrete = fixtures.map((f, i) => ({ ...f, a: { kind: 'entry' as const, entryId: values[template[i][0]] ?? '' }, b: { kind: 'entry' as const, entryId: values[template[i][1]] ?? '' } }));
      resolved = resolveBracket(concrete, localResults, eligible, d.policies.match).fixtures.map((f, i) => ({ ...f, fixture: fixtures[i] }));
    }
    out.resolvedFixtures.push(...resolved);
    const isComplete = resolved.every(f => f.state === 'completed');
    if (isComplete)
      completed.add(node.id);
    const state = isComplete ? 'completed' : resolved.some(f => f.state === 'ready') ? 'ready' : 'waiting';
    if (node.module === 'match@1') {
      out.graphStages[node.id] = { state, entryIds, winnerEntryId: resolved[0].winnerEntryId, loserEntryId: resolved[0].loserEntryId };
      continue;
    }
    const stageInput = options.stageInputs?.[node.id];
    const inputRevision = stageInput?.inputRevision ?? options.inputRevision ?? 0;
    const draws = stageInput?.rankingDraws ?? [];
    const ranking = computeStandings(entryIds, resolved.flatMap(f => f.result && f.entryA && f.entryB ? [{ a: f.entryA, b: f.entryB, scoreA: f.result.scoreA, scoreB: f.result.scoreB, outcome: f.result.outcome, winner: f.result.winnerEntryId, accepted: true }] : []), d.policies.ranking.order, draws.filter(draw => draw.inputRevision === inputRevision).map(draw => draw.entryIds), options.excludedByNode?.[node.id]);
    const unresolvedTies = ranking.ties.filter(tie => tie.filter(id => eligible.includes(id)).length > 1);
    out.graphStages[node.id] = { state: isComplete && unresolvedTies.length ? 'blocked' : state, entryIds, rows: ranking.rows, ties: ranking.ties, inputRevision, rankingDraws: draws, ...(isComplete && unresolvedTies.length ? { blockedCode: 'UNRESOLVED_TIE' } : {}) };
    out.standings.push(...ranking.rows);
    if (isComplete)
      out.ties.push(...unresolvedTies);
  }
  if (results.some(r => !out.fixtures.some(f => f.id === r.fixtureId)))
    throw new Error('Results must reference known graph fixtures.');
  scheduleFairly(schedulingBlocks, d.event.courts, Math.ceil(d.scheduling.minimum_rest_minutes / d.scheduling.estimated_slot_minutes));
  out.bracket = { state: out.resolvedFixtures.every(f => f.state === 'completed') ? 'completed' : out.resolvedFixtures.some(f => f.state === 'ready') ? 'ready' : 'waiting', fixtures: out.resolvedFixtures, eligibleEntryIds: eligible };
  return out;
}
