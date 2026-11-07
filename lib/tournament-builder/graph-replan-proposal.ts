import type { CommandActor, CommandSnapshot, StorageRow } from './commands';
import { analyzeReplan } from './replan-analysis';
import { analyzeGraph } from './graph-runtime';
import { graphDependencies, graphManualEntries, type GraphDefinition, type GraphRuntimeOptions } from './graph-types';
import { entryPlayerIds } from './entry-roster';
import { isEligibleEntry } from './disciplinary-eligibility';
import { resolvedDefinition } from './resolved-definition';
import { definitionHash, DomainError, UUID } from './requests';
import type { FixtureResult, RuntimeOptions } from './types';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const current = (match: StorageRow) => match.is_current !== false && !match.voided_at;
const played = (match: StorageRow) => Boolean(match.started_at) || ['in_progress', 'score_entered', 'disputed'].includes(String(match.status)) || ['played', 'retirement'].includes(String(match.outcome_kind)) || match.score_a != null || match.score_b != null;
const facts = (match: StorageRow) => ({ id: match.id, logical_key: match.logical_key ?? null, team_a_id: match.team_a_id ?? null, team_b_id: match.team_b_id ?? null, status: match.status ?? null, outcome_kind: match.outcome_kind ?? null, score_a: match.score_a ?? null, score_b: match.score_b ?? null, winner_team_id: match.winner_team_id ?? null, player_a1_id: match.player_a1_id ?? null, player_a2_id: match.player_a2_id ?? null, player_b1_id: match.player_b1_id ?? null, player_b2_id: match.player_b2_id ?? null, submit_to_dupr: match.submit_to_dupr ?? false });

/** A pure, conservative proposal; storage authorization and atomic application are not yet implemented. */
export function previewGraphReplanProposal(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (Object.keys(data).some(key => !['nodes', 'manual_match_entries', 'decisions', 'reason'].includes(key))) fail('INVALID_REQUEST', 'Unexpected replan proposal field.');
  if (typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 1000) fail('INVALID_REQUEST', 'Provide a reason for the proposed change.');
  const versionedStages = snapshot.stages.some(stage => typeof stage.definition_id === 'string');
  const stages = versionedStages ? snapshot.stages.filter(stage => stage.definition_id === snapshot.event?.definition_id) : snapshot.stages;
  const stageIds = new Set(stages.map(stage => stage.id));
  const activeSnapshot = { ...snapshot, stages, standings: snapshot.standings.filter(row => stageIds.has(String(row.stage_id))) };
  const structural = analyzeReplan(activeSnapshot, actor, { nodes: data.nodes });
  if (structural.requires_owner_reopen) fail('INVALID_STATE', 'The owner must reopen completed results before reviewing this proposal.');
  if (structural.unidentified_match_ids.length) fail('INVALID_STATE', 'Some current matches have no identifiable block; resolve them before replanning.');
  const before = resolvedDefinition(activeSnapshot)!.definition as GraphDefinition;
  const after = { ...before, nodes: structural.proposed_nodes } as GraphDefinition;
  for (const node of after.nodes) {
    const previous = before.nodes.find(item => item.id === node.id);
    if (previous && previous.module !== node.module) fail('INVALID_DEFINITION', 'Use a new block ID when changing a block type.');
  }
  if (!data.manual_match_entries || typeof data.manual_match_entries !== 'object' || Array.isArray(data.manual_match_entries)) fail('INVALID_REQUEST', 'Provide the complete manual match assignment map, even if empty.');
  const manual = data.manual_match_entries as Record<string, { a?: string; b?: string }>;
  if (Object.keys(manual).length > 64) fail('INVALID_REQUEST', 'Too many manual match assignments.');
  const registered = snapshot.teams.filter(team => isEligibleEntry(snapshot,team)).map(team => team.id);
  const roster = record(stages.find(stage => stage.module_id === 'entries')?.output).entryIds;
  if (!Array.isArray(roster)) fail('INVALID_STATE', 'A locked roster is required.');
  for (const [id, value] of Object.entries(manual)) {
    if (!after.nodes.some(node => node.id === id && node.module === 'match@1') || !value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => key !== 'a' && key !== 'b') || Object.values(value).some(team => typeof team !== 'string' || !UUID.test(team) || !registered.includes(team) || !(roster as unknown[]).includes(team)) || (value.a && value.b && value.a === value.b)) fail('INVALID_REQUEST', 'Choose valid, distinct, eligible roster teams for match assignments.');
  }
  const oldManual = graphManualEntries(stages, before) ?? {};
  const changed = new Set(structural.changed_node_ids);
  for (const id of new Set([...Object.keys(oldManual), ...Object.keys(manual)])) if (definitionHash(oldManual[id] ?? null) !== definitionHash(manual[id] ?? null)) changed.add(id);
  const affected = new Set(changed), nodes = [...before.nodes, ...after.nodes];
  let expanded = true;
  while (expanded) { expanded = false; for (const node of nodes) if (!affected.has(node.id) && graphDependencies(node).some(id => affected.has(id))) { affected.add(node.id); expanded = true; } }
  if (stages.some(stage => affected.has(String(stage.node_id)) && Array.isArray(record(stage.output).rankingDraws) && (record(stage.output).rankingDraws as unknown[]).length > 0)) fail('INVALID_STATE', 'An affected block has a recorded tie draw that requires separate review.');
  for (const id of Object.keys(manual)) if (after.nodes.some(node => node.module !== 'placements@2' && node.id !== id && graphDependencies(node).includes(id))) fail('UNSUPPORTED_FORMAT', 'Manual assignments to nonterminal blocks need a broader route review.');
  const byStage = new Map(stages.map(stage => [stage.id, String(stage.node_id)]));
  const matches = snapshot.matches.filter(current);
  const affectedMatches = matches.filter(match => affected.has(byStage.get(String(match.stage_id))!));
  if (!Array.isArray(data.decisions) || data.decisions.length > matches.length) fail('INVALID_REQUEST', 'Provide a decision for each affected match.');
  const decisions = new Map<string, 'preserve' | 'invalidate'>();
  for (const value of data.decisions as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST', 'Each match decision must be an object.');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some(key => !['match_id', 'action'].includes(key)) || typeof item.match_id !== 'string' || !UUID.test(item.match_id) || !['preserve', 'invalidate'].includes(String(item.action)) || decisions.has(item.match_id) || !affectedMatches.some(match => match.id === item.match_id)) fail('INVALID_REQUEST', 'Choose one valid decision for each affected match only.');
    decisions.set(item.match_id as string, item.action as 'preserve' | 'invalidate');
  }
  const missing = affectedMatches.filter(match => !decisions.has(match.id));
  const base = { tournament_id: snapshot.event!.id, event_revision: Number(snapshot.event!.revision), reason: (data.reason as string).trim(), changed_node_ids: [...changed].sort(), affected_node_ids: [...affected].sort(), affected_matches: affectedMatches.map(facts), missing_decision_ids: missing.map(match => match.id), proposed_nodes: after.nodes, manual_match_entries: manual, requires_storage_validation: true, executable: false };
  if (missing.length) return { ...base, ready_for_review: false };
  const archived = affectedMatches.filter(match => decisions.get(match.id) === 'invalidate');
  for (const match of matches.filter(played)) {
    const pairs = [[match.player_a1_id, match.player_a2_id], [match.player_b1_id, match.player_b2_id]], size = snapshot.event!.type === 'singles' ? 1 : snapshot.event!.type === 'doubles' ? 2 : 0;
    const players = pairs.flat().filter(Boolean);
    if (!size || pairs.some(side => !side[0] || (size === 2 ? !side[1] : side[1] != null)) || new Set(players).size !== size * 2) fail('INVALID_STATE', 'Historical player identities are incomplete or duplicated.');
  }
  const retained = matches.filter(match => !archived.some(old => old.id === match.id));
  if (retained.some(match => !match.logical_key || (['validated', 'walkover'].includes(String(match.status)) && !match.outcome_kind) || (match.status === 'scheduled' && (match.score_a != null || match.score_b != null)))) fail('INVALID_STATE', 'A retained match has incomplete or inconsistent result data.');
  if (new Set(retained.map(match => match.logical_key)).size !== retained.length) fail('INVALID_STATE', 'Current match identities are not unique.');
  const rosterOutput = record(stages.find(stage => stage.module_id === 'entries')?.output), ids = rosterOutput.entryIds;
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) fail('INVALID_STATE', 'A locked roster is required.');
  const rosterIds = ids as string[];
  const stageInputs: GraphRuntimeOptions['stageInputs'] = Object.fromEntries(after.nodes.map(node => { const stage = stages.find(row => row.node_id === node.id); return [node.id, { inputRevision: Math.max(0, ...retained.filter(match => match.stage_id === stage?.id).map(match => Number(match.result_revision ?? 0))), rankingDraws: record(stage?.output).rankingDraws as RuntimeOptions['rankingDraws'] }]; }));
  const results: FixtureResult[] = retained.filter(match => match.logical_key && (match.outcome_kind || ['score_entered', 'disputed'].includes(String(match.status)))).map(match => ({ fixtureId: String(match.logical_key), accepted: ['validated', 'walkover'].includes(String(match.status)), outcome: (match.outcome_kind ?? 'played') as FixtureResult['outcome'], winnerEntryId: match.winner_team_id as string | null, scoreA: match.score_a as number | null, scoreB: match.score_b as number | null }));
  let analysis: ReturnType<typeof analyzeGraph>;
  try { analysis = analyzeGraph(after, rosterIds.map(id => ({ id, playerIds: entryPlayerIds(snapshot, id) })), results, { seedAssignments: rosterOutput.seedAssignments as GraphRuntimeOptions['seedAssignments'], eligibleEntryIds: snapshot.teams.filter(team => rosterIds.includes(team.id) && isEligibleEntry(snapshot,team)).map(team => team.id), stageInputs, excludedByNode: rosterOutput.excludedByNode as Record<string, string[]> | undefined, manualMatchEntries: manual }); }
  catch { return fail('DEPENDENCY_CHANGED', 'The proposed routes cannot preserve all selected results consistently; review the affected matches and assignments.'); }
  if (analysis.blockedCode === 'INVALID_CAPACITY') fail('INVALID_STATE', 'The current roster is incomplete or incompatible with the proposed graph.');
  const placement = after.nodes.find(node => node.module === 'placements@2');
  if (placement?.module === 'placements@2' && placement.bronze && (manual[placement.final] || manual[placement.bronze])) {
    const final = analysis.graphStages[placement.final]?.entryIds ?? [], bronze = analysis.graphStages[placement.bronze]?.entryIds ?? [];
    if (final.length !== 2 || bronze.length !== 2 || final.some(id => bronze.includes(id))) fail('INVALID_STATE', 'Review both placement matches; their current teams must be known and distinct.');
  }
  for (const match of retained) {
    const fixture = analysis.resolvedFixtures.find(item => item.fixture.id === match.logical_key);
    if (!fixture || (fixture.entryA ?? null) !== (match.team_a_id ?? null) || (fixture.entryB ?? null) !== (match.team_b_id ?? null)) fail('DEPENDENCY_CHANGED', 'A match chosen for preservation has different or unresolved teams in the proposed graph.');
  }
  const planned = analysis.resolvedFixtures.map(item => ({ logical_key: item.fixture.id, node_id: item.fixture.stageId, team_a_id: item.entryA ?? null, team_b_id: item.entryB ?? null, wave: item.fixture.wave, court: item.fixture.court, preserved_match_id: retained.find(match => match.logical_key === item.fixture.id)?.id ?? null }));
  const scheduleMismatches = retained.filter(match => { const fixture = analysis.fixtures.find(item => item.id === match.logical_key), round = snapshot.rounds.find(item => item.id === match.round_id); return !fixture || !round || Number(round.logical_wave) !== fixture.wave || Number(match.court_number) !== fixture.court; }).map(match => match.id);
  const previousPlacement = stages.find(stage => stage.module_id === 'placements');
  const previousOutput = record(previousPlacement?.output);
  const review = { ...base, missing_decision_ids: [], decisions: [...decisions].map(([match_id, action]) => ({ match_id, action })).sort((a, b) => a.match_id.localeCompare(b.match_id)), archived_matches: archived.map(facts), preserved_match_ids: retained.map(match => match.id).sort(), planned_matches: planned, schedule_mismatch_match_ids: scheduleMismatches, current_standings: activeSnapshot.standings.map(row => ({ stage_id: row.stage_id ?? null, team_id: row.team_id ?? null, rank: row.rank ?? null, wins: row.wins ?? null, losses: row.losses ?? null, points_for: row.points_for ?? null, points_against: row.points_against ?? null, eligible: row.eligible ?? null })), proposed_standings: Object.entries(analysis.graphStages).flatMap(([node_id, stage]) => stage.rows ? [{ node_id, rows: stage.rows, ties: stage.ties ?? [] }] : []), proposed_ties: analysis.ties, current_placements: { state: previousPlacement?.state ?? null, champion_entry_id: previousOutput.championEntryId ?? null }, proposed_placements: analysis.placements ?? null, runtime_state: analysis.state, blocked_code: analysis.blockedCode ?? null, dupr_history_unknown: archived.some(played), ready_for_review: scheduleMismatches.length === 0 && !analysis.blockedCode };
  return { ...review, preview_hash: definitionHash(review) };
}
