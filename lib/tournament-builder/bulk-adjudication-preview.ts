import type { CommandActor, CommandSnapshot, StorageRow } from './commands';
import { entryPlayerIds } from './entry-roster';
import { isEligibleEntry } from './disciplinary-eligibility';
import { graphDependencies, graphManualEntries, type GraphRuntimeOptions } from './graph-types';
import { analyzeGraph } from './graph-runtime';
import { isLegalScore, type OutcomeKind } from './policies';
import { DomainError, UUID } from './requests';
import { resolvedDefinition } from './resolved-definition';
import type { FixtureResult, RuntimeOptions } from './types';
import { validateDraft } from './validate';
import { analyzeTournament } from './runtime';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const current = (match: StorageRow) => match.is_current !== false && !match.voided_at;

/** A read-only simulation; dependent games are listed conservatively, not approved for replay. */
export function previewBulkAdjudication(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (!snapshot.event || !(snapshot.event.created_by === actor.id || actor.role === 'admin') || (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage'))) fail('FORBIDDEN', 'Administrator permission required.');
  if (snapshot.event!.modular_state !== 'active') fail('INVALID_STATE', 'A tournament must be active for this simulation.');
  if (Object.keys(data).some(key => !['entry_id', 'match_ids', 'mode', 'winner_score', 'loser_score'].includes(key))) fail('INVALID_REQUEST', 'Unknown field.');
  const entryId = typeof data.entry_id === 'string' && UUID.test(data.entry_id) && snapshot.teams.some(team => team.id === data.entry_id) ? data.entry_id : fail('NOT_FOUND', 'Entry not found.');
  if (!Array.isArray(data.match_ids) || !data.match_ids.length || data.match_ids.length > 64 || !data.match_ids.every(id => typeof id === 'string' && UUID.test(id)) || new Set(data.match_ids).size !== data.match_ids.length) fail('INVALID_REQUEST', 'Select between one and 64 distinct match IDs.');
  const validated = validateDraft(resolvedDefinition(snapshot)?.definition, { registration: true }).definition;
  const d = validated ?? fail('INVALID_DEFINITION', 'A complete supported format is required.');
  if (!['walkover', 'score'].includes(String(data.mode))) fail('INVALID_REQUEST', 'Select a walkover or administrative score.');
  if (data.mode === 'score') {
    if (!isLegalScore(data.winner_score as number, data.loser_score as number, d.policies.match) || Number(data.winner_score) <= Number(data.loser_score)) fail('INVALID_SCORE', 'The opponent score must be a legal winning score.');
  } else if (data.winner_score !== undefined || data.loser_score !== undefined) fail('INVALID_REQUEST', 'Walkovers do not have points.');
  const selected = (data.match_ids as string[]).map(id => {
    const match = snapshot.matches.find(row => row.id === id && current(row));
    if (!match || !['scheduled', 'in_progress', 'score_entered', 'disputed', 'validated', 'walkover'].includes(String(match.status)) || !match.team_a_id || !match.team_b_id || ![match.team_a_id, match.team_b_id].includes(entryId)) fail('INVALID_STATE', 'Each selected match must be current and have both participants including the selected entry.');
    return match!;
  });
  const proposed = selected.map(match => {
    const winner = match.team_a_id === entryId ? match.team_b_id : match.team_a_id;
    return { match_id: match.id, team_a_id: match.team_a_id, team_b_id: match.team_b_id, before: { status: match.status, outcome_kind: match.outcome_kind ?? null, winner_team_id: match.winner_team_id ?? null, score_a: match.score_a ?? null, score_b: match.score_b ?? null, result_revision: match.result_revision ?? 0, started_at: match.started_at ?? null, ended_at: match.ended_at ?? null, submit_to_dupr: match.submit_to_dupr ?? false }, after: { disposition: 'administrative_adjudication', outcome_kind: data.mode === 'score' ? 'administrative_score' : 'walkover', winner_team_id: winner, score_a: data.mode === 'score' ? (match.team_a_id === winner ? data.winner_score : data.loser_score) : null, score_b: data.mode === 'score' ? (match.team_b_id === winner ? data.winner_score : data.loser_score) : null, submit_to_dupr: false } };
  });
  const proposals = new Map(proposed.map(row => [row.match_id, row.after]));
  if (d.schema_version !== '2.0') {
    const stage = snapshot.stages.find(row => row.module_id === 'round_robin');
    const elimination = snapshot.stages.find(row => row.module_id === 'elimination');
    if (selected.length === 1 && elimination && selected[0].stage_id === elimination.id) {
      const source = selected[0], initial = source.winner_team_id !== proposed[0].after.winner_team_id ? [source.bracket_next_winner_match_id, source.bracket_next_loser_match_id].filter(Boolean).map(String) : [];
      const descendants = new Set<string>(), pending = [...initial];
      while (pending.length) {
        const id = pending.shift()!; if (descendants.has(id)) continue;
        const match = snapshot.matches.find(row => row.id === id && current(row)); if (!match) continue;
        descendants.add(id);
        for (const key of ['bracket_next_winner_match_id', 'bracket_next_loser_match_id']) if (match[key]) pending.push(String(match[key]));
      }
      const preserved = snapshot.matches.filter(match => current(match) && match.id !== source.id && !descendants.has(match.id) && (match.started_at || ['validated', 'walkover', 'score_entered', 'disputed', 'in_progress'].includes(String(match.status)))).map(match => ({ id: match.id, stage_id: match.stage_id ?? null, team_a_id: match.team_a_id ?? null, team_b_id: match.team_b_id ?? null, status: match.status ?? null, outcome_kind: match.outcome_kind ?? null, score_a: match.score_a ?? null, score_b: match.score_b ?? null, winner_team_id: match.winner_team_id ?? null }));
      return { event_revision: Number(snapshot.event!.revision), entry_id: entryId, mode: data.mode, complete_impact_preview: false, bulk_action_available: false, selected_matches: proposed, projected_source_standings: [], preserved_intermediate_matches: preserved, potentially_affected_match_ids: [...descendants].sort(), v1_elimination_source: true };
    }
    if (!stage || selected.some(match => match.stage_id !== stage.id)) fail('INVALID_STATE', 'Select v1 round-robin games together, or one elimination game separately.');
    const roster = record(snapshot.stages.find(row => row.module_id === 'entries')?.output), ids = roster.entryIds as string[];
    if (!Array.isArray(ids)) fail('INVALID_STATE', 'A locked roster is required.');
    const matches = snapshot.matches.filter(match => current(match) && match.stage_id === stage!.id).map(match => {
      const next = proposals.get(match.id);
      return next ? { ...match, outcome_kind: next.outcome_kind, winner_team_id: next.winner_team_id, score_a: next.score_a, score_b: next.score_b, status: next.outcome_kind === 'walkover' ? 'walkover' : 'validated', result_revision: Number(snapshot.event!.revision) + 1 } : match;
    });
    const results: FixtureResult[] = matches.filter(match => match.logical_key && (match.outcome_kind || ['score_entered', 'disputed'].includes(String(match.status)))).map(match => ({ fixtureId: String(match.logical_key), accepted: ['validated', 'walkover'].includes(String(match.status)), outcome: (match.outcome_kind ?? 'played') as OutcomeKind, winnerEntryId: match.winner_team_id as string | null, scoreA: match.score_a as number | null, scoreB: match.score_b as number | null }));
    const inputRevision = Math.max(0, ...matches.map(match => Number(match.result_revision ?? 0)));
    const ranking = snapshot.stages.find(row => row.module_id === 'standings');
    const analysis = analyzeTournament(d, ids.map(id => ({ id, playerIds: entryPlayerIds(snapshot, id) })), results, { allowIncompleteRoster: true, rosterRevision: Number(snapshot.event!.roster_revision), inputRevision, rankingDraws: record(ranking?.output).rankingDraws as RuntimeOptions['rankingDraws'], roundRobinExclusions: roster.roundRobinExclusions as string[] | undefined, eligibleEntryIds: snapshot.teams.filter(team => ids.includes(team.id) && isEligibleEntry(snapshot,team)).map(team => team.id) });
    return { event_revision: Number(snapshot.event!.revision), entry_id: entryId, mode: data.mode, complete_impact_preview: false, bulk_action_available: false, selected_matches: proposed, projected_source_standings: [{ node_id: String(stage!.node_id), rows: analysis.standings, ties: analysis.ties }], projected_qualifier_ids: analysis.qualifiers, qualification_blocked: Boolean(analysis.blockedCode), preserved_intermediate_matches: [] as StorageRow[], potentially_affected_match_ids: snapshot.matches.filter(match => current(match) && match.stage_id === elimination?.id).map(match => match.id).sort() };
  }
  const sourceNodes = new Set(selected.map(match => String(snapshot.stages.find(stage => stage.id === match.stage_id)?.node_id)));
  if ([...sourceNodes].some(id => !d.nodes.some(node => node.id === id))) fail('INVALID_STATE', 'A selected match has no current graph stage.');
  const downstream = new Set(sourceNodes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of d.nodes) if (!downstream.has(node.id) && graphDependencies(node).some(id => downstream.has(id))) { downstream.add(node.id); changed = true; }
  }
  // Keep the existing path between selected stages until the simulation proves
  // each intervening result and selected pairing still belongs to the same teams.
  const upstream = new Set(sourceNodes);
  let added = true;
  while (added) { added = false; for (const node of d.nodes) if (upstream.has(node.id)) for (const dependency of graphDependencies(node)) if (!upstream.has(dependency)) { upstream.add(dependency); added = true; } }
  const selectedPath = new Set([...downstream].filter(id => upstream.has(id)));
  for (const id of upstream) downstream.delete(id);
  const stageById = new Map(snapshot.stages.map(stage => [stage.id, String(stage.node_id)]));
  const included = snapshot.matches.filter(match => current(match) && !downstream.has(stageById.get(String(match.stage_id)) ?? '')).map(match => {
    const outcome = proposals.get(match.id);
    return outcome ? { ...match, outcome_kind: outcome.outcome_kind, winner_team_id: outcome.winner_team_id, score_a: outcome.score_a, score_b: outcome.score_b, status: outcome.outcome_kind === 'walkover' ? 'walkover' : 'validated', result_revision: Number(snapshot.event!.revision) + 1 } : match;
  });
  const roster = record(snapshot.stages.find(stage => stage.module_id === 'entries')?.output);
  const ids = roster.entryIds as string[];
  if (!Array.isArray(ids)) fail('INVALID_STATE', 'A locked roster is required.');
  const stageInputs: GraphRuntimeOptions['stageInputs'] = Object.fromEntries(snapshot.stages.map(stage => [String(stage.node_id), { inputRevision: Math.max(0, ...included.filter(match => match.stage_id === stage.id).map(match => Number(match.result_revision ?? 0))), rankingDraws: record(stage.output).rankingDraws as RuntimeOptions['rankingDraws'] }]));
  const results: FixtureResult[] = included.filter(match => match.logical_key && (match.outcome_kind || ['score_entered', 'disputed'].includes(String(match.status)))).map(match => ({ fixtureId: String(match.logical_key), accepted: ['validated', 'walkover'].includes(String(match.status)), outcome: (match.outcome_kind ?? 'played') as OutcomeKind, winnerEntryId: match.winner_team_id as string | null, scoreA: match.score_a as number | null, scoreB: match.score_b as number | null }));
  let analysis: ReturnType<typeof analyzeGraph>;
  try {
    analysis = analyzeGraph(d, ids.map(id => ({ id, playerIds: entryPlayerIds(snapshot, id) })), results, { allowIncompleteRoster: true, seedAssignments: roster.seedAssignments as GraphRuntimeOptions['seedAssignments'], stageInputs, eligibleEntryIds: snapshot.teams.filter(team => isEligibleEntry(snapshot,team)).map(team => team.id), excludedByNode: roster.excludedByNode as Record<string, string[]> | undefined, manualMatchEntries: graphManualEntries(snapshot.stages, d) });
  } catch (error) {
    if (error instanceof Error && /winner|participating|feeder|accepted outcome|placement matches/i.test(error.message)) return fail('DEPENDENCY_CHANGED', 'A selected or intervening game may have different participants; review that dependency separately.');
    throw error;
  }
  for (const match of included) {
    const stageId = stageById.get(String(match.stage_id));
    if (!proposals.has(match.id) && (!stageId || !selectedPath.has(stageId) || match.status === 'scheduled')) continue;
    const resolved = analysis.resolvedFixtures.find(fixture => fixture.fixture.id === match.logical_key);
    const original = snapshot.matches.find(old => old.id === match.id)!;
    if (!resolved || (resolved.entryA ?? null) !== (original.team_a_id ?? null) || (resolved.entryB ?? null) !== (original.team_b_id ?? null)) fail('DEPENDENCY_CHANGED', 'A selected or intervening game has different participants; review that dependency separately.');
  }
  const standings = [...sourceNodes].flatMap(nodeId => {
    const stage = analysis.graphStages[nodeId];
    return stage?.rows ? [{ node_id: nodeId, rows: stage.rows, ties: stage.ties ?? [] }] : [];
  });
  const preserved = included.filter(match => !proposals.has(match.id) && upstream.has(stageById.get(String(match.stage_id)) ?? '') && (match.started_at || ['validated', 'walkover', 'score_entered', 'disputed', 'in_progress'].includes(String(match.status)))).map(match => ({ id: match.id, stage_id: match.stage_id ?? null, team_a_id: match.team_a_id ?? null, team_b_id: match.team_b_id ?? null, status: match.status ?? null, outcome_kind: match.outcome_kind ?? null, score_a: match.score_a ?? null, score_b: match.score_b ?? null, winner_team_id: match.winner_team_id ?? null }));
  return { event_revision: Number(snapshot.event!.revision), entry_id: entryId, mode: data.mode, complete_impact_preview: false, bulk_action_available: false, selected_matches: proposed, projected_source_standings: standings, preserved_intermediate_matches: preserved, potentially_affected_match_ids: snapshot.matches.filter(match => current(match) && downstream.has(stageById.get(String(match.stage_id)) ?? '')).map(match => match.id).sort() };
}
