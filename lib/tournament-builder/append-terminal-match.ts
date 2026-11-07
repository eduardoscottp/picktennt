import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { isEligibleEntry } from './disciplinary-eligibility';
import { graphManualEntries, type GraphDefinition, type GraphNode } from './graph-types';
import { previewGraphReplanProposal } from './graph-replan-proposal';
import { resolvedDefinition } from './resolved-definition';
import { definitionHash, DomainError } from './requests';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const current = (row: StorageRow) => row.is_current !== false && !row.voided_at;

/** Conservative append-only slice: all existing games are complete and remain untouched. */
export function previewAppendTerminalMatch(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (Object.keys(data).some(key => !['nodes', 'reason'].includes(key))) fail('INVALID_REQUEST', 'Unexpected proposal field.');
  const before = resolvedDefinition(snapshot)?.definition as GraphDefinition | undefined;
  if (before?.schema_version !== '2.0' || !Array.isArray(data.nodes)) return fail('UNSUPPORTED_FORMAT', 'A complete block-graph proposal is required.');
  if (!data.nodes.every(node => node && typeof node === 'object' && !Array.isArray(node) && typeof (node as Record<string, unknown>).id === 'string' && typeof (node as Record<string, unknown>).module === 'string')) return fail('INVALID_REQUEST', 'Each proposed block needs an identifier and module.');
  if (snapshot.event?.modular_state !== 'active' || snapshot.event.results_under_review !== true) fail('INVALID_STATE', 'The owner must reopen completed results before adding a match.');
  const nodes = data.nodes as GraphNode[], currentStages = snapshot.stages.filter(stage => !stage.definition_id || stage.definition_id === snapshot.event?.definition_id);
  const beforeIds = new Set(before.nodes.map(node => node.id));
  const additions = nodes.filter(node => !beforeIds.has(node?.id));
  if (nodes.length !== before.nodes.length + 1 || additions.length !== 1 || additions[0].module !== 'match@1') return fail('UNSUPPORTED_FORMAT', 'This operation can add exactly one terminal match; other structural changes need a broader review.');
  const next = additions[0];
  if (currentStages.some(stage => stage.node_id === next.id)) fail('INVALID_STATE', 'This block ID has already been used.');
  const placement = before.nodes.find(node => node.module === 'placements@2'), proposedPlacement = nodes.find(node => node.id === placement?.id);
  if (placement?.module !== 'placements@2' || proposedPlacement?.module !== 'placements@2') return fail('INVALID_DEFINITION', 'The current placement block must be retained.');
  for (const node of before.nodes) if (node.id !== placement.id && (!nodes.some(candidate => candidate.id === node.id) || definitionHash(nodes.find(candidate => candidate.id === node.id)) !== definitionHash(node))) fail('UNSUPPORTED_FORMAT', 'Existing blocks cannot be modified or removed by this operation.');
  const placementMode = proposedPlacement.final === next.id && proposedPlacement.bronze === placement.bronze ? 'final' : proposedPlacement.final === placement.final && !placement.bronze && proposedPlacement.bronze === next.id ? 'bronze' : undefined;
  if (!placementMode || Object.keys(proposedPlacement).some(key => !['id', 'module', 'final', 'bronze'].includes(key))) fail('UNSUPPORTED_FORMAT', 'Connect the added match as a new final or previously absent third-place match.');
  if (!Array.isArray(next.inputs) || next.inputs.length !== 2 || next.inputs.some(input => !input || !['winner', 'loser'].includes(input.kind))) fail('UNSUPPORTED_FORMAT', 'Both participants must come from completed match results.');
  const existing = snapshot.matches.filter(current);
  if (!existing.length || existing.some(match => !['validated', 'walkover'].includes(String(match.status)) || !match.outcome_kind)) fail('INVALID_STATE', 'Finish or separately review all existing games before appending a terminal match.');
  const sources = next.inputs.map(input => {
    if (input.kind !== 'winner' && input.kind !== 'loser') return fail('UNSUPPORTED_FORMAT', 'Choose prior match outcomes.');
    const stage = currentStages.find(row => row.node_id === input.node_id), source = existing.find(row => row.stage_id === stage?.id && row.logical_key === `${input.node_id}:match`);
    if (!stage || !source || !source.team_a_id || !source.team_b_id || !source.winner_team_id || ![source.team_a_id, source.team_b_id].includes(source.winner_team_id)) return fail('INVALID_STATE', 'Both source matches need an accepted winner and two known teams.');
    const pointer = input.kind === 'winner' ? source.bracket_next_winner_match_id : source.bracket_next_loser_match_id;
    if (pointer) fail('INVALID_STATE', 'A selected outcome already feeds another match.');
    const team_id = input.kind === 'winner' ? source.winner_team_id : source.winner_team_id === source.team_a_id ? source.team_b_id : source.team_a_id;
    return { match_id: source.id, node_id: input.node_id, kind: input.kind, team_id };
  });
  if (sources[0].team_id === sources[1].team_id) fail('INVALID_STATE', 'A team cannot play itself.');
  const required = before.registration.entry_type === 'singles' ? 1 : 2;
  for (const source of sources) {
    const team = snapshot.teams.find(row => row.id === source.team_id);
    const members = new Set(snapshot.team_members.filter(member => member.team_id === source.team_id && member.membership_status === 'active' && typeof member.user_id === 'string').map(member => member.user_id));
    if (!team || !isEligibleEntry(snapshot,team) || (Array.isArray(team.guest_players) && team.guest_players.length > 0) || members.size !== required) fail('INCOMPLETE_ROSTER', 'Both source teams need complete, eligible registered rosters.');
  }
  const manual = graphManualEntries(currentStages, before) ?? {};
  const proposed = previewGraphReplanProposal(snapshot, actor, { nodes, manual_match_entries: manual, decisions: [], reason: data.reason });
  if (!('planned_matches' in proposed)) return fail('INVALID_STATE', 'The proposed schedule requires further review.');
  if (!proposed.ready_for_review) fail('INVALID_STATE', 'The proposed schedule, standings or ties require further review.');
  const fixture = proposed.planned_matches.find(match => match.node_id === next.id);
  if (!fixture || fixture.preserved_match_id || fixture.team_a_id !== sources[0].team_id || fixture.team_b_id !== sources[1].team_id) return fail('INVALID_STATE', 'The proposed participants could not be verified.');
  const previousPlacement = currentStages.find(stage => stage.node_id === placement.id);
  if (!previousPlacement) return fail('INVALID_STATE', 'The current placement stage is unavailable.');
  if (previousPlacement.state !== 'blocked' || previousPlacement.blocked_code !== 'RESULTS_UNDER_REVIEW' || record(previousPlacement.output).state !== 'completed' || !record(previousPlacement.output).championEntryId) fail('INVALID_STATE', 'Complete the current placements and reopen them for review before adding this match.');
  const nextWave = Math.max(0, ...snapshot.rounds.map(round => Number(round.logical_wave) || 0)) + 1;
  const review = { tournament_id: snapshot.event!.id, event_revision: Number(snapshot.event!.revision), reason: String(data.reason).trim(), nodes, new_node_id: next.id, placement_node_id: placement.id, placement_mode: placementMode, sources, fixture: { ...fixture, wave: nextWave, court: 1 }, preserved_match_ids: existing.map(match => match.id).sort(), prior_champion_entry_id: record(previousPlacement.output).championEntryId ?? null, placements_reset: true };
  return { ...review, preview_hash: definitionHash(review) };
}

/** Plan exactly the reviewed append-only operation through the shared transaction. */
export function planAppendTerminalMatch(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  const { preview_hash, ...proposal } = data, review = previewAppendTerminalMatch(snapshot, actor, proposal);
  if (preview_hash !== review.preview_hash) fail('STALE_PREVIEW', 'Review the current proposal before confirming.');
  const stages = snapshot.stages.filter(stage => !stage.definition_id || stage.definition_id === snapshot.event?.definition_id);
  const entries = stages.find(stage => stage.module_id === 'entries')!, placement = stages.find(stage => stage.node_id === review.placement_node_id)!;
  const stageId = context.id(), roundId = context.id(), matchId = context.id(), revision = review.event_revision + 1;
  const feederPatches = new Map<string, StorageRow>();
  review.sources.forEach((source, index) => {
    const patch: StorageRow = feederPatches.get(source.match_id) ?? { id: source.match_id };
    if (source.kind === 'winner') { patch.bracket_next_winner_match_id = matchId; patch.bracket_winner_fills_side = index === 0 ? 'a' : 'b'; }
    else { patch.bracket_next_loser_match_id = matchId; patch.bracket_loser_fills_side = index === 0 ? 'a' : 'b'; }
    feederPatches.set(source.match_id, patch);
  });
  return { effects: {
    stages: [
      { id: entries.id, output: { ...record(entries.output), finalizedNodes: review.nodes } },
      { id: stageId, definition_id: snapshot.event!.definition_id, node_id: review.new_node_id, module_id: 'match', module_version: 1, state: 'ready', input_revision: 0, output_revision: revision, output: { state: 'ready', entryIds: [review.fixture.team_a_id, review.fixture.team_b_id], inputRevision: 0 }, blocked_code: null },
      { id: placement.id, state: 'ready', output_revision: revision, output: { state: 'ready' }, blocked_code: null },
    ],
    rounds: [{ id: roundId, stage_id: stageId, logical_wave: review.fixture.wave, round_number: Math.max(0, ...snapshot.rounds.map(round => Number(round.round_number) || 0)) + 1, round_type: review.placement_mode === 'final' ? 'finals_gold' : 'finals_bronze', status: 'pending', schedule_generation: snapshot.event!.roster_revision, is_current: true }],
    matches: [{ id: matchId, round_id: roundId, stage_id: stageId, logical_key: review.fixture.logical_key, court_number: review.fixture.court, team_a_id: review.fixture.team_a_id, team_b_id: review.fixture.team_b_id, schedule_generation: snapshot.event!.roster_revision, is_current: true, status: 'scheduled', revision, result_revision: 0, submit_to_dupr: false }, ...feederPatches.values()],
  }, result: { match_id: matchId } };
}
