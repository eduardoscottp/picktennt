import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { previewBulkAdjudication } from './bulk-adjudication-preview';
import { planGraphRuntime } from './graph-command-runtime';
import { planInternalRuntime } from './commands';
import { DomainError, definitionHash } from './requests';
import { resolvedDefinition } from './resolved-definition';
import { validateDraft } from './validate';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const row = (s: CommandSnapshot, id: string) => s.matches.find(match => match.id === id)!;
const proposalFields = ['entry_id', 'match_ids', 'mode', 'winner_score', 'loser_score'];

/** Rebuild the whole operation from the current event; never combine independent single-game previews. */
function build(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, now: string) {
  const why = typeof data.reason === 'string' && data.reason.trim() && data.reason.length <= 1000 ? data.reason.trim() : fail('INVALID_REQUEST', 'A reason is required.');
  if (typeof data.regenerate_downstream !== 'boolean' || typeof data.overwrite_existing !== 'boolean') fail('INVALID_REQUEST', 'Choose whether to overwrite existing results and regenerate dependents.');
  const proposal = Object.fromEntries(Object.entries(data).filter(([key]) => proposalFields.includes(key)));
  const simulation = previewBulkAdjudication(snapshot, actor, proposal);
  const existing = simulation.selected_matches.filter(match => !['scheduled', 'in_progress'].includes(String(match.before.status)) || match.before.outcome_kind !== null || match.before.score_a !== null || match.before.score_b !== null);
  if (existing.length && data.overwrite_existing !== true) fail('INVALID_REQUEST', 'Existing or provisional results require explicit overwrite.');
  const validated = validateDraft(resolvedDefinition(snapshot)?.definition, { registration: true }).definition;
  const definition = validated ?? fail('INVALID_DEFINITION', 'A complete supported format is required.');
  const work = structuredClone(snapshot), next = Number(work.event!.revision) + 1;
  const archive = data.regenerate_downstream ? simulation.potentially_affected_match_ids : [];
  const eliminationSource = 'v1_elimination_source' in simulation && simulation.v1_elimination_source;
  const rosterStage = definition.schema_version !== '2.0' && !eliminationSource ? work.stages.find(stage => stage.module_id === 'entries') : undefined;
  if (eliminationSource && !data.regenerate_downstream && simulation.potentially_affected_match_ids.some(id => { const match = row(work, id); return Boolean(match.started_at) || ['validated', 'walkover', 'score_entered', 'disputed', 'in_progress'].includes(String(match.status)); })) fail('DOWNSTREAM_STARTED', 'Changed bracket inputs require an explicit regeneration preview.');
  if (rosterStage && simulation.potentially_affected_match_ids.length) {
    const started = simulation.potentially_affected_match_ids.some(id => { const match = row(work, id); return Boolean(match.started_at) || ['validated', 'walkover', 'score_entered', 'disputed', 'in_progress'].includes(String(match.status)); });
    const qualification = work.stages.find(stage => stage.module_id === 'qualify');
    const previous = ((qualification?.output ?? {}) as Record<string, unknown>).entryIds;
    const predicted = 'projected_qualifier_ids' in simulation ? simulation.projected_qualifier_ids : [];
    if (started && !data.regenerate_downstream && (('qualification_blocked' in simulation && simulation.qualification_blocked) || JSON.stringify(previous) !== JSON.stringify(predicted))) fail('DOWNSTREAM_STARTED', 'Changed qualification requires an explicit regeneration preview.');
    rosterStage.output = { ...((rosterStage.output ?? {}) as Record<string, unknown>), qualifierSlots: null, qualificationUnderReview: true };
  }
  const matches: StorageRow[] = archive.map(id => ({ id, is_current: false, voided_at: now, ...(row(work, id).started_at && !row(work, id).ended_at ? { ended_at: now } : {}) }));
  for (const selected of simulation.selected_matches) {
    const old = row(work, selected.match_id), outcome = selected.after;
    matches.push({ id: selected.match_id, outcome_kind: outcome.outcome_kind, winner_team_id: outcome.winner_team_id, score_a: outcome.score_a, score_b: outcome.score_b, status: outcome.outcome_kind === 'walkover' ? 'walkover' : 'validated', submitted_entry_id: null, entered_by: null, validated_by: actor.id, submit_to_dupr: false, ended_at: old.started_at ? old.ended_at ?? now : old.ended_at ?? null, result_revision: next, revision: next });
  }
  for (const patch of matches) Object.assign(row(work, patch.id), patch);
  // Stable new fixture IDs keep preview and commit aligned for the same revision/proposal.
  const seed = definitionHash({ event_id: snapshot.event!.id, event_revision: snapshot.event!.revision, proposal, regenerate_downstream: data.regenerate_downstream });
  let counter = 0;
  const id = () => { const hex = definitionHash({ seed, counter: counter++ }); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
  const allowedMissing = new Set(snapshot.matches.filter(match => archive.includes(match.id) && typeof match.logical_key === 'string').map(match => String(match.logical_key)));
  const runtime = definition.schema_version === '2.0' ? planGraphRuntime(work, definition, actor, { now, id }, next, new Set(), allowedMissing) : planInternalRuntime(work, actor, { now, id }, data.regenerate_downstream === true);
  const before = new Map(snapshot.matches.map(match => [match.id, match]));
  const changedFixtures = (runtime.effects.matches ?? []).filter(patch => !simulation.selected_matches.some(match => match.match_id === patch.id)).map(patch => {
    const old = before.get(patch.id);
    const value = (key: string) => Object.hasOwn(patch, key) ? patch[key] : old?.[key] ?? null;
    return { match_id: patch.id, stage_id: value('stage_id'), before_team_a_id: old?.team_a_id ?? null, before_team_b_id: old?.team_b_id ?? null, after_team_a_id: value('team_a_id'), after_team_b_id: value('team_b_id'), before_status: old?.status ?? null, after_status: value('status'), after_outcome_kind: value('outcome_kind'), after_winner_team_id: value('winner_team_id'), before_next_winner_id: old?.bracket_next_winner_match_id ?? null, after_next_winner_id: value('bracket_next_winner_match_id'), before_next_loser_id: old?.bracket_next_loser_match_id ?? null, after_next_loser_id: value('bracket_next_loser_match_id'), new_fixture: !old };
  });
  const qualification = (runtime.effects.stages ?? []).flatMap(patch => {
    const old = snapshot.stages.find(stage => stage.id === patch.id);
    if (old?.module_id !== 'qualify') return [];
    const before = (old.output ?? {}) as Record<string, unknown>, after = (patch.output ?? {}) as Record<string, unknown>;
    return [{ stage_id: patch.id, before_entry_ids: before.entryIds ?? [], after_entry_ids: after.entryIds ?? [], state: patch.state ?? old.state ?? null, blocked_code: patch.blocked_code ?? null }];
  });
  const impact = { event_revision: simulation.event_revision, entry_id: simulation.entry_id, mode: simulation.mode, selected_matches: simulation.selected_matches, preserved_intermediate_matches: simulation.preserved_intermediate_matches, archived_matches: archive.map(id => { const old = row(snapshot, id); return { match_id: id, stage_id: old.stage_id ?? null, status: old.status ?? null, outcome_kind: old.outcome_kind ?? null, team_a_id: old.team_a_id ?? null, team_b_id: old.team_b_id ?? null, score_a: old.score_a ?? null, score_b: old.score_b ?? null, winner_team_id: old.winner_team_id ?? null, started_at: old.started_at ?? null, ended_at: old.ended_at ?? null, result_revision: old.result_revision ?? 0, submit_to_dupr: old.submit_to_dupr ?? false }; }), changed_fixtures: changedFixtures, qualification, standings: runtime.effects.standings ?? [], runtime_state: runtime.result.runtime_state, blocked_code: runtime.result.blocked_code ?? null, regenerate_downstream: data.regenerate_downstream, overwrite_existing: data.overwrite_existing, reason: why, dupr_history_unknown: existing.some(match => match.before.outcome_kind === 'played') || archive.some(id => row(snapshot, id).outcome_kind === 'played') };
  const hash = definitionHash(impact);
  return { impact, hash, effects: { ...runtime.effects, ...(rosterStage ? { stages: [{ id: rosterStage.id, output: rosterStage.output }, ...(runtime.effects.stages ?? [])] } : {}), matches: [...matches, ...(runtime.effects.matches ?? [])] }, result: { selected_match_ids: simulation.selected_matches.map(match => match.match_id), archived_match_ids: archive, ...runtime.result } };
}

export function previewBulkOperation(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (Object.keys(data).some(key => ![...proposalFields, 'reason', 'regenerate_downstream', 'overwrite_existing'].includes(key))) fail('INVALID_REQUEST', 'Unknown preview field.');
  const operation = build(snapshot, actor, data, '2000-01-01T00:00:00.000Z');
  return { ...operation.impact, preview_hash: operation.hash };
}

export function planBulkOperation(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  if (Object.keys(data).some(key => ![...proposalFields, 'reason', 'regenerate_downstream', 'overwrite_existing', 'preview_hash'].includes(key))) fail('INVALID_REQUEST', 'Unknown command field.');
  const operation = build(snapshot, actor, data, context.now);
  if (data.preview_hash !== operation.hash) fail('STALE_PREVIEW', 'Review the current complete impact.');
  return { effects: operation.effects, result: operation.result };
}
