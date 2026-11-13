import type { CommandActor, CommandSnapshot } from './commands';
import { isEligibleEntry } from './disciplinary-eligibility';
import { entryPlayerIds } from './entry-roster';
import { analyzeGraph } from './graph-runtime';
import { graphRankLocks } from './graph-rank-locks';
import { planGraphRuntime } from './graph-command-runtime';
import { graphManualEntries, graphOrder, graphSources, type GraphDefinition, type GraphRuntimeOptions } from './graph-types';
import { graphSupportsStageReview, isReviewedGeneralGraph } from './graph-generation-policy';
import { definitionHash, DomainError } from './requests';
import type { FixtureResult } from './types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const accepted = (status: unknown) => ['validated', 'walkover'].includes(String(status));

/** Replay pending graph outcomes on a copy so review includes cascaded byes. */
export function simulateGraphNextStage(snapshot: CommandSnapshot, actor: CommandActor, definition: GraphDefinition, fixtureIds: readonly string[]) {
  const copy = structuredClone(snapshot);
  const roster = copy.stages.find(stage => stage.module_id === 'entries' && (!stage.definition_id || stage.definition_id === copy.event?.definition_id));
  if (!roster || !copy.event) throw new DomainError('INVALID_STATE', 'The tournament roster must be locked first.');
  roster.output = { ...record(roster.output), graphNextStageApproved: true };
  let sequence = 0;
  const id = () => {
    const hex = definitionHash({ event: copy.event!.id, revision: copy.event!.revision, sequence: ++sequence });
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const plan = planGraphRuntime(copy, definition, actor, { now: '1970-01-01T00:00:00.000Z', id }, Number(copy.event.revision) + 1, new Set(), new Set(fixtureIds));
  const matches = (plan.effects.matches ?? []).filter(match => typeof match.logical_key === 'string' && fixtureIds.includes(match.logical_key));
  const placements = plan.effects.stages?.find(stage => copy.stages.find(prior => prior.id === stage.id)?.module_id === 'placements');
  return {
    matches: matches.map(match => ({
      id: String(match.logical_key), team_a_id: match.team_a_id ?? null, team_b_id: match.team_b_id ?? null,
      outcome_kind: match.outcome_kind ?? null, winner_team_id: match.winner_team_id ?? null,
      score_a: match.score_a ?? null, score_b: match.score_b ?? null,
    })),
    champion_entry_id: record(placements?.output).championEntryId ?? null,
  };
}

/** Read-only review of the fixtures already materialized by the graph runtime. */
export function previewGraphNextStage(snapshot: CommandSnapshot, actor: CommandActor, definition: GraphDefinition) {
  if (!snapshot.event || (snapshot.event.created_by !== actor.id && actor.role !== 'admin')) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (!['ready', 'active', 'completed'].includes(String(snapshot.event.modular_state))) throw new DomainError('INVALID_STATE', 'The tournament roster must be locked first.');
  const stages = snapshot.stages.filter(stage => !stage.definition_id || stage.definition_id === snapshot.event?.definition_id);
  const rosterOutput = record(stages.find(stage => stage.module_id === 'entries')?.output);
  const ids = rosterOutput.entryIds;
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new DomainError('INVALID_STATE', 'The tournament roster must be locked first.');
  const entries = ids.map(id => ({ id, playerIds: entryPlayerIds(snapshot, id) }));
  const current = snapshot.matches.filter(match => match.is_current !== false && !match.voided_at);
  const stageInputs: NonNullable<GraphRuntimeOptions['stageInputs']> = {};
  for (const node of definition.nodes) {
    const stage = stages.find(row => row.node_id === node.id);
    if (!stage) throw new DomainError('INVALID_STATE', 'The configured tournament stages are unavailable.');
    stageInputs[node.id] = {
      inputRevision: Math.max(0, ...current.filter(match => match.stage_id === stage.id).map(match => Number(match.result_revision ?? 0))),
      rankingDraws: record(stage.output).rankingDraws as GraphRuntimeOptions['rankingDraws'],
    };
  }
  const options: GraphRuntimeOptions = {
    allowIncompleteRoster: true,
    seedAssignments: rosterOutput.seedAssignments as GraphRuntimeOptions['seedAssignments'],
    eligibleEntryIds: snapshot.teams.filter(team => ids.includes(team.id) && isEligibleEntry(snapshot, team)).map(team => team.id),
    stageInputs, excludedByNode: rosterOutput.excludedByNode as GraphRuntimeOptions['excludedByNode'],
    manualMatchEntries: graphManualEntries(stages, definition),
  };
  const results: FixtureResult[] = current.filter(match => match.logical_key && (match.outcome_kind || ['score_entered', 'disputed'].includes(String(match.status)))).map(match => ({
    fixtureId: String(match.logical_key), accepted: accepted(match.status), outcome: (match.outcome_kind ?? 'played') as FixtureResult['outcome'],
    winnerEntryId: match.winner_team_id as string | null, scoreA: match.score_a as number | null, scoreB: match.score_b as number | null,
  }));
  options.lockedRanks = graphRankLocks(definition, entries, options, stages, current);
  const analysis = analyzeGraph(definition, entries, results, options);
  if (analysis.blockedCode === 'INVALID_CAPACITY') throw new DomainError('INVALID_STATE', 'The locked roster does not match the tournament format.');
  const deferred = new Set(definition.nodes.filter(node => graphSources(node).some(source => source.kind !== 'seed')).map(node => node.id));
  const initialNoContest = current.some(match => match.outcome_kind === 'no_contest' && definition.nodes.some(node => node.module === 'match@1' && node.inputs.every(source => source.kind === 'seed') && stages.find(stage => stage.id === match.stage_id)?.node_id === node.id && definition.nodes.some(target => graphSources(target).some(source => source.kind !== 'seed' && source.node_id === node.id))));
  const groupGraph = isReviewedGeneralGraph(definition) || initialNoContest;
  const deferredStageIds = new Set(stages.filter(stage => deferred.has(String(stage.node_id))).map(stage => stage.id));
  const approved = rosterOutput.graphNextStageApproved === true || current.some(match => deferredStageIds.has(String(match.stage_id)));
  const fixtureIds = new Set(analysis.fixtures.map(fixture => fixture.id));
  const requiredFixtures = approved ? analysis.fixtures : analysis.fixtures.filter(fixture => !deferred.has(fixture.stageId));
  const missing = requiredFixtures.filter(fixture => current.filter(match => match.logical_key === fixture.id).length !== 1).length;
  const playingStageIds = new Set(stages.filter(stage => ['round_robin', 'cross_play', 'match'].includes(String(stage.module_id))).map(stage => stage.id));
  const unknown = current.filter(match => playingStageIds.has(String(match.stage_id)) && (!match.logical_key || !fixtureIds.has(String(match.logical_key)))).length;
  const base = { event_revision: Number(snapshot.event.revision), missing_matches: missing + unknown };
  if (missing || unknown) return { ...base, state: 'blocked' as const, reason: 'SCHEDULE_INCONSISTENT' as const, pending_results: 0, fixtures: [] };
  if (snapshot.event.results_under_review === true) return { ...base, state: 'blocked' as const, reason: 'RESULTS_UNDER_REVIEW' as const, pending_results: 0, fixtures: [] };
  if (analysis.state === 'completed') return { ...base, state: 'finished' as const, pending_results: 0, fixtures: [] };

  const dependent = graphOrder(definition).filter(node => node.module === 'match@1' || graphSources(node).some(source => source.kind !== 'seed'));
  const initialStages = new Set(stages.filter(stage => definition.nodes.some(node => node.id === stage.node_id && ['round_robin@2', 'cross_play@1', 'match@1'].includes(node.module) && !deferred.has(node.id))).map(stage => stage.id));
  const pending = current.filter(match => initialStages.has(String(match.stage_id)) && (!accepted(match.status) || !match.outcome_kind)).length;
  const placement = definition.nodes.find(node => node.module === 'placements@2');
  const eligible = (id: unknown) => typeof id === 'string' && id ? options.eligibleEntryIds!.includes(id) : null;
  const fixtures = analysis.resolvedFixtures.filter(resolved => dependent.some(node => node.id === resolved.fixture.stageId) && (approved || deferred.has(resolved.fixture.stageId))).map(resolved => {
    const node = dependent.find(item => item.id === resolved.fixture.stageId)!;
    const stage = stages.find(item => item.node_id === node.id)!;
    const match = current.find(item => item.logical_key === resolved.fixture.id);
    const sources = graphSources(node);
    return {
      id: resolved.fixture.id, stage_id: node.id, match_id: match?.id ?? null,
      kind: placement?.module === 'placements@2' && placement.final === node.id ? 'final' : placement?.module === 'placements@2' && placement.bronze === node.id ? 'bronze' : node.module,
      state: resolved.state, saved_status: match ? String(match.status) : null,
      team_a_id: resolved.entryA ?? null, team_b_id: resolved.entryB ?? null,
      side_a_eligible: eligible(resolved.entryA), side_b_eligible: eligible(resolved.entryB),
      required_outcome: resolved.requiredOutcome ?? null,
      outcome_kind: match && accepted(match.status) ? match.outcome_kind ?? null : null,
      winner_team_id: match && accepted(match.status) ? match.winner_team_id ?? null : null,
      sources,
      side_sources: analysis.fixtureSources[resolved.fixture.id],
      stage_state: String(stage.state),
    };
  });
  const rankingSources = definition.nodes.filter(node => deferred.has(node.id)).flatMap(node => graphSources(node)).filter(source => source.kind === 'rank' && !deferred.has(source.node_id));
  const unresolvedTies = rankingSources.filter(source => {
    if (source.kind !== 'rank') return false;
    const prior = analysis.graphStages[source.node_id];
    const locked = options.lockedRanks?.[source.node_id];
    const id = locked && Object.hasOwn(locked, source.rank) ? locked[source.rank] : (locked ? prior?.rows : prior?.rows?.filter(row => options.eligibleEntryIds!.includes(row.entryId)))?.[source.rank - 1]?.entryId;
    return !locked && !!id && !!prior?.ties?.some(group => group.includes(id) && group.filter(entryId => options.eligibleEntryIds!.includes(entryId)).length > 1);
  }).length;
  if (approved) return { ...base, state: 'existing' as const, compatibility_mode: !graphSupportsStageReview(definition, stages), pending_results: pending, unresolved_ties: unresolvedTies, fixtures };
  if (!deferred.size) return { ...base, state: 'existing' as const, compatibility_mode: false, pending_results: 0, unresolved_ties: 0, fixtures };
  if (pending) return { ...base, state: 'blocked' as const, reason: 'RESULTS_INCOMPLETE' as const, pending_results: pending, fixtures: [] };
  if (unresolvedTies) return { ...base, state: 'blocked' as const, reason: 'UNRESOLVED_TIE' as const, pending_results: 0, fixtures: [] };
  // The storage boundary currently verifies match-only graphs with no overrides or automatic outcomes.
  if (Object.keys(graphManualEntries(stages, definition) ?? {}).length > 0) {
    return { ...base, state: 'blocked' as const, reason: 'UNSUPPORTED_FORMAT' as const, pending_results: 0, fixtures: [] };
  }
  if (snapshot.disciplinary_excluded_team_ids?.length) return { ...base, state: 'blocked' as const, reason: 'UNSUPPORTED_FORMAT' as const, pending_results: 0, fixtures: [] };
  const unsupportedGroupState = definition.nodes.some(node => {
    if (!deferred.has(node.id) || !['round_robin@2', 'cross_play@1'].includes(node.module)) return false;
    const draws = record(stages.find(stage => stage.node_id === node.id)?.output).rankingDraws;
    const excluded = record(rosterOutput.excludedByNode)[node.id];
    return (Array.isArray(draws) && draws.length > 0) || (Array.isArray(excluded) && excluded.length > 0);
  });
  if (groupGraph && unsupportedGroupState) return { ...base, state: 'blocked' as const, reason: 'UNSUPPORTED_FORMAT' as const, pending_results: 0, fixtures: [] };
  const simulation = simulateGraphNextStage(snapshot, actor, definition, fixtures.map(fixture => fixture.id));
  const projected = fixtures.map(fixture => {
    const predicted = simulation.matches.find(match => match.id === fixture.id);
    if (!predicted) throw new DomainError('INVALID_STATE', 'The next-stage review is unavailable.');
    return { ...fixture, team_a_id: predicted.team_a_id, team_b_id: predicted.team_b_id,
      side_a_eligible: eligible(predicted.team_a_id), side_b_eligible: eligible(predicted.team_b_id),
      required_outcome: predicted.outcome_kind ?? fixture.required_outcome, outcome_kind: predicted.outcome_kind,
      winner_team_id: predicted.winner_team_id, score_a: predicted.score_a, score_b: predicted.score_b };
  });
  const auto = simulation.matches.some(match => match.outcome_kind);
  const automaticGroups = new Set(projected.filter(fixture => fixture.outcome_kind && ['round_robin@2', 'cross_play@1'].includes(fixture.kind)).map(fixture => fixture.stage_id));
  const completedAutomaticStages = new Set(definition.nodes.filter(node => projected.some(fixture => fixture.stage_id === node.id) && projected.filter(fixture => fixture.stage_id === node.id).every(fixture => !!fixture.outcome_kind)).map(node => node.id));
  const supportedGroupAutomatic = groupGraph && auto &&
    [...automaticGroups].every(id => {
      const node = definition.nodes.find(candidate => candidate.id === id)!;
      return graphSources(node).every(source => source.kind === 'seed' || !deferred.has(source.node_id) || completedAutomaticStages.has(source.node_id));
    });
  const pendingFuture = simulation.matches.some(match => !match.outcome_kind);
  const allCurrentComplete = current.every(match => accepted(match.status) && !!match.outcome_kind);
  const approvedCount = options.eligibleEntryIds!.length;
  const sqlApprovedCount = snapshot.teams.filter(team => ids.includes(team.id) && team.entry_state === 'approved').length;
  const supportedAutomatic = supportedGroupAutomatic || (!groupGraph && approvedCount === sqlApprovedCount && (pendingFuture || (allCurrentComplete && (!!simulation.champion_entry_id || approvedCount === 0))));
  if ((auto && !supportedAutomatic) || (groupGraph && projected.some(fixture => ['round_robin@2', 'cross_play@1'].includes(fixture.kind) && (fixture.side_a_eligible === false || fixture.side_b_eligible === false) && !automaticGroups.has(fixture.stage_id)))) {
    const blocked = { ...base, state: 'blocked' as const, reason: 'UNSUPPORTED_FORMAT' as const, pending_results: 0, fixtures: projected, champion_entry_id: simulation.champion_entry_id };
    return { ...blocked, preview_hash: definitionHash({ tournament_id: snapshot.event.id, ...blocked }) };
  }
  const review = { ...base, state: 'ready' as const, pending_results: 0, unresolved_ties: 0, fixtures: projected, champion_entry_id: simulation.champion_entry_id, no_eligible_champion: approvedCount === 0 && !pendingFuture };
  return { ...review, preview_hash: definitionHash({ tournament_id: snapshot.event.id, ...review }) };
}
