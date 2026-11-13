import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { isEligibleEntry } from './disciplinary-eligibility';
import { graphManualEntries, graphOrder, graphSources, type GraphDefinition, type GraphRuntimeOptions } from './graph-types';
import { graphSupportsStageReview } from './graph-generation-policy';
import { analyzeGraph } from './graph-runtime';
import { graphRankLocks } from './graph-rank-locks';
import { entryPlayerIds } from './entry-roster';
import { DomainError } from './requests';
import type { FixtureResult } from './types';

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const accepted = (m: StorageRow) => ['validated', 'walkover'].includes(String(m.status));

/** Produce effects through the existing atomic command boundary; never write independently. */
export function planGraphRuntime(snapshot: CommandSnapshot, d: GraphDefinition, actor: CommandActor, context: CommandContext, revision: number, disciplinaryExcludedEntryIds: ReadonlySet<string> = new Set(), regenerateLogicalKeys: ReadonlySet<string> = new Set(), preserveWithdrawnRanks = true): CommandPlan {
  const s = structuredClone(snapshot), effects: CommandPlan['effects'] = {};
  s.stages = s.stages.filter(stage => !stage.definition_id || stage.definition_id === s.event?.definition_id);
  function put(table: 'stages' | 'rounds' | 'matches' | 'standings', patch: StorageRow) {
    const old = s[table].findIndex(r => r.id === patch.id);
    if (old < 0) s[table].push(patch); else s[table][old] = { ...s[table][old], ...patch };
    const patches = effects[table] ??= [];
    const existing = patches.findIndex(r => r.id === patch.id);
    if (existing < 0) patches.push(patch); else patches[existing] = { ...patches[existing], ...patch };
  }
  const rosterStage = s.stages.find(stage => stage.module_id === 'entries')!;
  const output = record(rosterStage.output), ids = output.entryIds as string[];
  const roster = ids.map(id => ({ id, playerIds: entryPlayerIds(s, id) }));
  const current = () => s.matches.filter(m => m.is_current !== false && !m.voided_at);
  const keys = current().map(match => match.logical_key);
  if (keys.some(key => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) throw new DomainError('SCHEDULE_INCONSISTENT', 'A saved tournament match is missing or duplicated. Review the schedule before continuing.');
  const deferredNodes = new Set(d.nodes.filter(node => graphSources(node).some(source => source.kind !== 'seed')).map(node => node.id));
  const deferredStageIds = new Set(s.stages.filter(stage => deferredNodes.has(String(stage.node_id))).map(stage => stage.id));
  // Previously generated graphs must keep their original IDs and propagation behavior.
  const approved = deferredNodes.size === 0 || !graphSupportsStageReview(d, s.stages) || output.graphNextStageApproved === true || current().some(match => deferredStageIds.has(String(match.stage_id))) || [...regenerateLogicalKeys].some(key => deferredNodes.has(key.split(':')[0]));
  const stageInputs = Object.fromEntries(d.nodes.map(node => {
    const stage = s.stages.find(stage => stage.node_id === node.id)!;
    const inputRevision = Math.max(0, ...current().filter(m => m.stage_id === stage.id).map(m => Number(m.result_revision ?? 0)));
    return [node.id, { inputRevision, rankingDraws: record(stage.output).rankingDraws as GraphRuntimeOptions['rankingDraws'] }];
  }));
  const manualMatchEntries = graphManualEntries(s.stages, d);
  const options: GraphRuntimeOptions = { allowIncompleteRoster: true, seedAssignments: output.seedAssignments as GraphRuntimeOptions['seedAssignments'], eligibleEntryIds: s.teams.filter(t => ids.includes(t.id) && isEligibleEntry(s,t) && !disciplinaryExcludedEntryIds.has(t.id)).map(t => t.id), stageInputs, excludedByNode: output.excludedByNode as Record<string, string[]> | undefined, manualMatchEntries };
  if (preserveWithdrawnRanks) options.lockedRanks = graphRankLocks(d, roster, options, s.stages, current(), regenerateLogicalKeys);
  let analysis;
  // Each iteration accepts at least one automatic empty-slot outcome; graph size bounds propagation.
  for (let iteration = 0; iteration <= 128; iteration++) {
    for (const stage of s.stages) stageInputs[String(stage.node_id)].inputRevision = Math.max(0, ...current().filter(m => m.stage_id === stage.id).map(m => Number(m.result_revision ?? 0)));
    const results: FixtureResult[] = current().filter(m => m.logical_key && (m.outcome_kind || ['score_entered', 'disputed'].includes(String(m.status)))).map(m => ({ fixtureId: String(m.logical_key), accepted: accepted(m), outcome: (m.outcome_kind ?? 'played') as FixtureResult['outcome'], winnerEntryId: m.winner_team_id as string | null, scoreA: m.score_a as number | null, scoreB: m.score_b as number | null }));
    analysis = analyzeGraph(d, roster, results, options);
    const materialized = approved ? analysis.fixtures : analysis.fixtures.filter(fixture => !deferredNodes.has(fixture.stageId));
    if (current().length || s.event?.modular_state === 'active') {
      for (const fixture of materialized) {
        const saved = current().filter(match => match.logical_key === fixture.id);
        const stageId = s.stages.find(stage => stage.node_id === fixture.stageId)?.id;
        if (saved.length > 1 || (saved.length === 1 && saved[0].stage_id !== stageId) || (!saved.length && !regenerateLogicalKeys.has(fixture.id))) {
          throw new DomainError('SCHEDULE_INCONSISTENT', 'A saved tournament match is missing or duplicated. Review the schedule before continuing.');
        }
      }
    }
    const fixtureIds = new Map(materialized.map(f => [f.id, current().find(m => m.logical_key === f.id)?.id ?? context.id()]));
    const finalNode = d.nodes.find(n => n.module === 'placements@2');
    for (const fixture of materialized) {
      const stage = s.stages.find(stage => stage.node_id === fixture.stageId)!;
      const resolved = analysis.resolvedFixtures.find(f => f.fixture.id === fixture.id)!;
      const old = current().find(m => m.logical_key === fixture.id);
      const participant = (slot: typeof fixture.a, value: typeof resolved.entryA) => {
        if (value) return value;
        if (slot.kind === 'entry') return slot.entryId || null;
        const source = analysis!.graphStages[slot.fixtureId.slice(0, -':match'.length)];
        return (slot.kind === 'winner' ? source?.winnerEntryId : source?.loserEntryId) ?? null;
      };
      const a = participant(fixture.a, resolved.entryA), b = participant(fixture.b, resolved.entryB);
      if (old && (old.team_a_id !== a || old.team_b_id !== b) && old.status !== 'scheduled') throw new DomainError('DOWNSTREAM_STARTED', 'Changed block inputs require an impact preview and explicit replay.');
      const roundType = ['round_robin', 'cross_play'].includes(String(stage.module_id)) ? 'round_robin' : finalNode?.module === 'placements@2' && finalNode.final === stage.node_id ? 'finals_gold' : finalNode?.module === 'placements@2' && finalNode.bronze === stage.node_id ? 'finals_bronze' : 'elimination';
      // A new planner or newly resolved participants must not move a saved match.
      let round = old ? s.rounds.find(r => r.id === old.round_id) : s.rounds.find(r => r.stage_id === stage.id && r.logical_wave === fixture.wave && r.is_current !== false);
      if (!round) {
        round = { id: context.id(), stage_id: stage.id, logical_wave: fixture.wave, round_number: Math.max(0, ...s.rounds.map(r => Number(r.round_number))) + 1, round_type: roundType, status: 'pending', schedule_generation: s.event!.roster_revision, is_current: true };
        put('rounds', round);
      }
      if (!old || old.team_a_id !== a || old.team_b_id !== b) put('matches', { id: fixtureIds.get(fixture.id)!, round_id: round.id, stage_id: stage.id, logical_key: fixture.id, court_number: old ? old.court_number : fixture.court, team_a_id: a, team_b_id: b, schedule_generation: s.event!.roster_revision, is_current: true, ...(old ? {} : { status: 'scheduled', revision: 0, result_revision: 0, submit_to_dupr: false }) });
    }
    const routes = new Map<string, { feederId: string; kind: 'winner' | 'loser'; targets: { fixtureId: string; side: 'a' | 'b' }[] }>();
    for (const fixture of materialized) for (const [side, slot] of [['a', fixture.a], ['b', fixture.b]] as const) if (slot.kind !== 'entry') {
      const routeId = `${slot.kind}:${slot.fixtureId}`;
      const route = routes.get(routeId) ?? { feederId: slot.fixtureId, kind: slot.kind, targets: [] };
      route.targets.push({ fixtureId: fixture.id, side }); routes.set(routeId, route);
    }
    for (const route of routes.values()) {
      const feeder = current().find(match => match.logical_key === route.feederId);
      if (!feeder) continue;
      const key = route.kind === 'winner' ? 'bracket_next_winner_match_id' : 'bracket_next_loser_match_id';
      const fills = route.kind === 'winner' ? 'bracket_winner_fills_side' : 'bracket_loser_fills_side';
      // A legacy pointer is meaningful only when the graph has one destination.
      const target = route.targets.length === 1 ? fixtureIds.get(route.targets[0].fixtureId) : null;
      const side = route.targets.length === 1 ? route.targets[0].side : null;
      if ((feeder[key] ?? null) !== target || (feeder[fills] ?? null) !== side) put('matches', { id: feeder.id, [key]: target, [fills]: side });
    }
    let automated = false;
    for (const f of analysis.resolvedFixtures) if ((approved || !deferredNodes.has(f.fixture.stageId)) && f.state === 'ready' && f.requiredOutcome) {
      const m = current().find(m => m.logical_key === f.fixture.id)!;
      put('matches', { id: m.id, status: f.requiredOutcome === 'walkover' ? 'walkover' : 'validated', outcome_kind: f.requiredOutcome, winner_team_id: f.requiredOutcome === 'walkover' ? f.entryA ?? f.entryB : null, score_a: null, score_b: null, validated_by: actor.id, result_revision: revision, revision });
      automated = true;
    }
    if (!automated) break;
    if (iteration === 128) throw new DomainError('INVALID_STATE', 'Graph outcome propagation exceeded its bound.');
  }
  for (const node of d.nodes) {
    const stage = s.stages.find(stage => stage.node_id === node.id)!;
    const graph = analysis!.graphStages[node.id];
    const prior = record(stage.output);
    const payload = node.module === 'placements@2' ? analysis!.placements ?? {} : graph ? { ...prior, ...graph, inputRevision: stageInputs[node.id].inputRevision } : prior;
    const state = ['registration@1', 'entries@1'].includes(node.module) ? 'completed' : !approved && (deferredNodes.has(node.id) || node.module === 'placements@2') ? 'waiting' : graph?.state ?? analysis!.placements?.state ?? 'waiting';
    put('stages', { id: stage.id, state, input_revision: stageInputs[node.id].inputRevision, output_revision: revision, output: payload, blocked_code: state === 'blocked' ? graph?.blockedCode ?? analysis!.blockedCode ?? 'UNRESOLVED_TIE' : null });
    if (['round_robin@2', 'cross_play@1'].includes(node.module) && graph?.rows && (approved || !deferredNodes.has(node.id))) {
      const round = s.rounds.find(r => r.stage_id === stage.id && r.is_current !== false)!;
      const ranked = graph.rows.filter(row => options.eligibleEntryIds!.includes(row.entryId));
      graph.rows.forEach(row => {
        const eligible = options.eligibleEntryIds!.includes(row.entryId);
        const tie = eligible ? graph.ties?.map(group => group.filter(id => options.eligibleEntryIds!.includes(id))).find(group => group.length > 1 && group.includes(row.entryId)) : undefined;
        const rank = !eligible ? null : tie ? ranked.findIndex(r => tie.includes(r.entryId)) + 1 : ranked.indexOf(row) + 1;
        const old = s.standings.find(r => r.stage_id === stage.id && r.team_id === row.entryId);
        put('standings', { id: old?.id ?? context.id(), stage_id: stage.id, round_id: round.id, team_id: row.entryId, wins: row.wins, losses: row.losses, points_for: row.pointsFor, points_against: row.pointsAgainst, rank, input_revision: stageInputs[node.id].inputRevision, eligible: options.eligibleEntryIds!.includes(row.entryId), tie_group: tie ? tie.join(',') : null });
      });
      for (const row of s.standings.filter(r => r.stage_id === stage.id && !graph.rows!.some(current => current.entryId === r.team_id))) put('standings', { id: row.id, wins: 0, losses: 0, points_for: 0, points_against: 0, rank: null, input_revision: stageInputs[node.id].inputRevision, eligible: false, tie_group: null });
    }
  }
  // A feeder may reference a newly inserted successor through an immediate foreign key.
  const order = new Map(graphOrder(d).map((node, index) => [node.id, index]));
  effects.matches?.sort((a, b) => {
    const node = (id: string) => s.stages.find(stage => stage.id === s.matches.find(match => match.id === id)?.stage_id)?.node_id;
    return (order.get(String(node(b.id))) ?? -1) - (order.get(String(node(a.id))) ?? -1);
  });
  if (analysis!.state === 'completed') effects.event = { modular_state: 'completed', completed_at: context.now, result_version: Number(s.event!.result_version ?? 0) + 1, results_under_review: false };
  return { effects, result: { runtime_state: analysis!.state, ...(analysis!.blockedCode ? { blocked_code: analysis!.blockedCode } : {}) } };
}
