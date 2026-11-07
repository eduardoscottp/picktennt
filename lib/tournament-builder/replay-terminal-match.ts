import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { previewForcedPendingMatch } from './force-pending-match';
import { definitionHash, DomainError } from './requests';
import { resolvedDefinition } from './resolved-definition';
import type { GraphDefinition } from './graph-types';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const current = (match: StorageRow) => match.is_current !== false && !match.voided_at;
const facts = (match: StorageRow) => ({ id: match.id, team_a_id: match.team_a_id ?? null, team_b_id: match.team_b_id ?? null, status: match.status ?? null, started_at: match.started_at ?? null, ended_at: match.ended_at ?? null, outcome_kind: match.outcome_kind ?? null, score_a: match.score_a ?? null, score_b: match.score_b ?? null, winner_team_id: match.winner_team_id ?? null, player_a1_id: match.player_a1_id ?? null, player_a2_id: match.player_a2_id ?? null, player_b1_id: match.player_b1_id ?? null, player_b2_id: match.player_b2_id ?? null, submit_to_dupr: match.submit_to_dupr ?? false });

/** Review the explicit invalidation route; old results remain as historical facts. */
export function previewReplayTerminalMatch(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (Object.keys(data).some(key => !['match_id', 'team_a_id', 'team_b_id', 'reason', 'resolution'].includes(key)) || data.resolution !== 'invalidate_and_replay') fail('INVALID_REQUEST', 'Choose the explicit invalidate-and-replay resolution.');
  const match = snapshot.matches.find(row => row.id === data.match_id && current(row));
  if (!match) fail('NOT_FOUND', 'Current match not found.');
  if (match!.status === 'scheduled' && !match!.started_at && match!.score_a == null && match!.score_b == null && match!.outcome_kind == null) fail('INVALID_STATE', 'Use the pending-match review for an unplayed match.');
  if (!['scheduled', 'in_progress', 'score_entered', 'disputed', 'validated', 'walkover'].includes(String(match!.status)) || match!.bracket_next_winner_match_id || match!.bracket_next_loser_match_id) fail('INVALID_STATE', 'Only a terminal current match can use this operation.');
  const actualPlay = Boolean(match!.started_at) || ['in_progress', 'score_entered', 'disputed'].includes(String(match!.status)) || ['played', 'retirement'].includes(String(match!.outcome_kind)) || match!.score_a != null || match!.score_b != null;
  if (actualPlay) {
    const sides = [[match!.player_a1_id, match!.player_a2_id], [match!.player_b1_id, match!.player_b2_id]];
    const doubles = snapshot.event?.type === 'doubles';
    const players = sides.flat().filter(Boolean);
    if (!['singles', 'doubles'].includes(String(snapshot.event?.type)) || sides.some(side => !side[0] || (doubles ? !side[1] || side[0] === side[1] : side[1] != null)) || new Set(players).size !== players.length) fail('INVALID_STATE', 'Historical player identities are incomplete or duplicated; resolve them before invalidating this match.');
  }
  const candidate = structuredClone(snapshot), shadow = candidate.matches.find(row => row.id === match!.id)!;
  Object.assign(shadow, { status: 'scheduled', started_at: null, score_a: null, score_b: null, outcome_kind: null, player_a1_id: null, player_a2_id: null, player_b1_id: null, player_b2_id: null, team_a_id: null, team_b_id: null });
  const proposal = { match_id: data.match_id, team_a_id: data.team_a_id, team_b_id: data.team_b_id, reason: data.reason };
  const pending = previewForcedPendingMatch(candidate, actor, proposal);
  const definition = resolvedDefinition(snapshot)?.definition as GraphDefinition;
  const placementNode = definition.nodes.find(node => node.module === 'placements@2');
  const placementStage = snapshot.stages.find(row => row.node_id === placementNode?.id);
  if (!placementStage) fail('INVALID_STATE', 'The placement stage is unavailable.');
  const review = { tournament_id: pending.tournament_id, event_revision: pending.event_revision, match_id: pending.match_id, stage_id: pending.stage_id, before: facts(match!), after: pending.after, reason: pending.reason, resolution: 'invalidate_and_replay', detached_feeder_ids: pending.detached_feeder_ids, dupr_history_unknown: actualPlay, history_preserved: true, placements_reset: true, prior_placement_state: placementStage!.state ?? null, prior_champion_entry_id: record(placementStage!.output).championEntryId ?? null };
  return { ...review, preview_hash: definitionHash(review) };
}

export function planReplayTerminalMatch(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  const { preview_hash, ...proposal } = data;
  const review = previewReplayTerminalMatch(snapshot, actor, proposal);
  if (preview_hash !== review.preview_hash) fail('STALE_PREVIEW', 'Review the exact current intervention before confirming.');
  const old = snapshot.matches.find(match => match.id === review.match_id)!;
  const stage = snapshot.stages.find(row => row.id === review.stage_id)!;
  const definition = resolvedDefinition(snapshot)?.definition as GraphDefinition;
  const placements = definition.nodes.find(node => node.module === 'placements@2');
  const placementStage = snapshot.stages.find(row => row.node_id === placements?.id);
  if (!placementStage || placementStage.id === stage.id) fail('INVALID_STATE', 'The placement stage is unavailable.');
  const replacementId = context.id();
  const matches: StorageRow[] = [
    { id: old.id, is_current: false, voided_at: context.now, ...(old.started_at && !old.ended_at ? { ended_at: context.now } : {}) },
    { id: replacementId, stage_id: old.stage_id, round_id: old.round_id, logical_key: old.logical_key, schedule_generation: old.schedule_generation, court_number: old.court_number, team_a_id: review.after.team_a_id, team_b_id: review.after.team_b_id, is_current: true, status: 'scheduled', revision: review.event_revision + 1, result_revision: 0, submit_to_dupr: false },
  ];
  for (const feeder of snapshot.matches.filter(row => review.detached_feeder_ids.includes(row.id))) {
    const patch: StorageRow = { id: feeder.id };
    if (feeder.bracket_next_winner_match_id === old.id) { patch.bracket_next_winner_match_id = null; patch.bracket_winner_fills_side = null; }
    if (feeder.bracket_next_loser_match_id === old.id) { patch.bracket_next_loser_match_id = null; patch.bracket_loser_fills_side = null; }
    matches.push(patch);
  }
  return { effects: { matches, stages: [
    { id: stage.id, state: 'ready', input_revision: 0, output_revision: review.event_revision + 1, blocked_code: null, output: { ...record(stage.output), state: 'ready', entryIds: [review.after.team_a_id, review.after.team_b_id], winnerEntryId: null, loserEntryId: null, inputRevision: 0, blockedCode: null, manualMatchEntries: { a: review.after.team_a_id, b: review.after.team_b_id } } },
    { id: placementStage!.id, state: 'waiting', output_revision: review.event_revision + 1, blocked_code: null, output: { state: 'waiting' } },
  ] }, result: { match_id: replacementId, source_match_id: old.id, team_a_id: review.after.team_a_id, team_b_id: review.after.team_b_id, archived_match_ids: [old.id] } };
}
