import type { CommandActor, CommandSnapshot, StorageRow } from './commands';
import { graphDependencies, graphManualEntries, type GraphDefinition, type GraphNode } from './graph-types';
import { validateGraph } from './graph-validate';
import { validateDraft } from './validate';
import { resolvedDefinition } from './resolved-definition';
import { definitionHash, DomainError } from './requests';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const current = (match: StorageRow) => match.is_current !== false && !match.voided_at;
const facts = (match: StorageRow) => ({
  id: match.id, stage_id: match.stage_id ?? null, team_a_id: match.team_a_id ?? null,
  team_b_id: match.team_b_id ?? null, status: match.status ?? null, started_at: match.started_at ?? null,
  outcome_kind: match.outcome_kind ?? null, score_a: match.score_a ?? null, score_b: match.score_b ?? null,
  winner_team_id: match.winner_team_id ?? null, result_revision: match.result_revision ?? 0,
});

/** Structural analysis only: it is not a reviewed plan or permission to mutate a tournament. */
export function analyzeReplan(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (!snapshot.event) fail('NOT_FOUND', 'Tournament not found.');
  if (snapshot.event!.created_by !== actor.id && actor.role !== 'admin') fail('FORBIDDEN', 'Administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) fail('FORBIDDEN', 'Explicit administrator permission required.');
  if (!['ready', 'active', 'completed'].includes(String(snapshot.event!.modular_state))) fail('INVALID_STATE', 'Analyze a generated tournament.');
  if (Object.keys(data).some(key => key !== 'nodes') || !Array.isArray(data.nodes)) fail('INVALID_REQUEST', 'Provide the complete proposed node array.');
  const currentDefinition = resolvedDefinition(snapshot)?.definition as GraphDefinition | undefined;
  if (currentDefinition?.schema_version !== '2.0') fail('UNSUPPORTED_FORMAT', 'This structural analysis currently supports block-graph tournaments only.');
  const proposed = { ...currentDefinition!, nodes: data.nodes };
  const validation = validateDraft(proposed);
  if (!validation.valid || !validation.definition || validation.definition.schema_version !== '2.0') fail('INVALID_DEFINITION', 'The proposed blocks are invalid or incomplete.');
  const next = validation.definition as GraphDefinition;
  if (validateGraph(next).length) fail('INVALID_DEFINITION', 'The proposed block connections are invalid or incomplete.');
  const before = new Map(currentDefinition!.nodes.map(node => [node.id, node]));
  const after = new Map(next.nodes.map(node => [node.id, node]));
  const allIds = new Set([...before.keys(), ...after.keys()]);
  const changed = new Set([...allIds].filter(id => !before.has(id) || !after.has(id) || definitionHash(before.get(id)) !== definitionHash(after.get(id))));
  const affected = new Set(changed);
  const nodes: GraphNode[] = [...before.values(), ...after.values()];
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of nodes) if (!affected.has(node.id) && graphDependencies(node).some(id => affected.has(id))) { affected.add(node.id); expanded = true; }
  }
  const stageNodes = new Map(snapshot.stages.map(stage => [stage.id, String(stage.node_id)]));
  const matches = snapshot.matches.filter(current);
  const unidentifiedMatches = matches.filter(match => !stageNodes.has(String(match.stage_id)));
  const affectedMatches = matches.filter(match => !stageNodes.has(String(match.stage_id)) || affected.has(stageNodes.get(String(match.stage_id))!)).map(facts);
  const unaffectedMatches = matches.filter(match => stageNodes.has(String(match.stage_id)) && !affected.has(stageNodes.get(String(match.stage_id))!)).map(facts);
  return {
    tournament_id: snapshot.event!.id, event_revision: Number(snapshot.event!.revision),
    changed_node_ids: [...changed].sort(), affected_node_ids: [...affected].sort(),
    current_nodes: currentDefinition!.nodes, proposed_nodes: next.nodes,
    current_manual_match_entries: Object.entries(graphManualEntries(snapshot.stages, currentDefinition!) ?? {}).map(([node_id, value]) => ({ node_id, team_a_id: value?.a ?? null, team_b_id: value?.b ?? null })),
    affected_matches: affectedMatches, unaffected_matches: unaffectedMatches, unidentified_match_ids: unidentifiedMatches.map(match => match.id).sort(),
    has_started_or_recorded_results: affectedMatches.some(match => !!match.started_at || match.score_a != null || match.score_b != null || ['validated', 'walkover', 'disputed', 'score_entered', 'in_progress'].includes(String(match.status))),
    dupr_history_unknown: affectedMatches.some(match => match.outcome_kind === 'played' || (match.outcome_kind == null && match.status === 'validated' && match.score_a != null && match.score_b != null)),
    requires_owner_reopen: snapshot.event!.modular_state === 'completed',
    analysis_only: true, executable: false,
  };
}
