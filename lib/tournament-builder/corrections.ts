import { entryPlayerIds } from './entry-roster';
import { resolvedDefinition } from './resolved-definition';
import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { definitionHash, DomainError, UUID } from './requests';
import { validateDraft } from './validate';
import { isLegalScore, type OutcomeKind } from './policies';
import { analyzeTournament } from './runtime';
import { generateElimination } from './modules/elimination';
import type { FixtureResult, RuntimeOptions } from './types';
import { graphDependencies, type GraphDefinition } from './graph-types';
import { analyzeGraph } from './graph-runtime';
import type { GraphRuntimeOptions } from './graph-types';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const current = (s: CommandSnapshot) => s.matches.filter(m => m.is_current !== false && !m.voided_at);
const accepted = (m: StorageRow) => ['validated', 'walkover'].includes(String(m.status));
function keys(data: Record<string, unknown>, allowed: readonly string[]) { if (Object.keys(data).some(key => !allowed.includes(key))) fail('INVALID_REQUEST', 'Unknown intervention field.'); }
function ref(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) return fail('INVALID_REQUEST', 'A resource UUID is required.'); return value; }
function reason(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 1000) return fail('INVALID_REQUEST', 'A short explicit reason is required.'); return value.trim(); }
function authorized(snapshot: CommandSnapshot, actor: CommandActor, ownEntryId?: string) {
  if (!snapshot.event) fail('NOT_FOUND', 'Event not found.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) fail('FORBIDDEN', 'Interventions require the website.');
  const admin = snapshot.event!.created_by === actor.id || actor.role === 'admin';
  const own = ownEntryId && ['registration_open', 'registration_closed'].includes(String(snapshot.event!.modular_state)) && snapshot.team_members.some(m => m.team_id === ownEntryId && m.user_id === actor.id && m.membership_status !== 'cancelled');
  if (!admin && !own) fail('FORBIDDEN', 'Administrator permission required after roster lock.');
  if (['draft', 'cancelled'].includes(String(snapshot.event!.modular_state))) fail('INVALID_STATE', 'Intervention is unavailable in the current state.');
}
function definition(s: CommandSnapshot) {
  const d = validateDraft(resolvedDefinition(s)?.definition, { registration: true }).definition;
  return d ?? fail('INVALID_DEFINITION', 'A complete published definition is required.');
}
export interface CorrectedOutcome { outcome_kind: OutcomeKind; winner_team_id: string | null; score_a: number | null; score_b: number | null }
function normalize(s: CommandSnapshot, source: StorageRow, data: Record<string, unknown>): CorrectedOutcome {
  const kind = data.outcome_kind ?? 'played';
  if (!['played', 'walkover', 'retirement', 'no_contest'].includes(String(kind))) return fail('INVALID_SCORE', 'Unsupported outcome.');
  if (kind === 'walkover' && (source.started_at || ['played', 'retirement'].includes(String(source.outcome_kind)))) fail('INVALID_STATE', 'A physically started match requires retirement rather than walkover.');
  let winner: unknown = data.winner_entry_id ?? null;
  let a: number | null = null, b: number | null = null;
  if (kind === 'played') {
    if (!isLegalScore(data.score_a as number, data.score_b as number, definition(s).policies.match)) return fail('INVALID_SCORE', 'Correction requires a legal played score.');
    a = Number(data.score_a); b = Number(data.score_b); winner = a > b ? source.team_a_id : source.team_b_id;
    if (data.winner_entry_id !== undefined && winner !== data.winner_entry_id) fail('INVALID_SCORE', 'Winner disagrees with score.');
  } else if (kind === 'retirement') {
    
    for (const value of [data.score_a, data.score_b]) if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || Number(value) < 0)) fail('INVALID_SCORE', 'Informational partial scores must be nonnegative integers.');
    a = data.score_a == null ? null : Number(data.score_a); b = data.score_b == null ? null : Number(data.score_b);
  } else if (data.score_a != null || data.score_b != null) fail('INVALID_SCORE', 'Walkovers and no-contests cannot invent points.');
  if (kind === 'no_contest') { if (winner !== null) fail('INVALID_SCORE', 'No-contest has no winner.'); }
  else if (!winner || ![source.team_a_id, source.team_b_id].includes(winner)) fail('INVALID_SCORE', 'Winner must be a source participant.');
  return { outcome_kind: kind as OutcomeKind, winner_team_id: winner as string | null, score_a: a, score_b: b };
}
function descendants(s: CommandSnapshot, initial: readonly string[]): string[] {
  const active = current(s), pending = [...initial], seen = new Set<string>();
  while (pending.length) {
    const id = pending.shift()!; if (seen.has(id)) continue;
    const match = active.find(m => m.id === id); if (!match) continue;
    seen.add(id);
    for (const key of ['bracket_next_winner_match_id', 'bracket_next_loser_match_id']) if (match[key]) pending.push(String(match[key]));
  }
  return [...seen].sort();
}
/** A pool correction can affect any selected rank; include transitive block dependents. */
function graphDependents(s: CommandSnapshot, d: GraphDefinition, nodeId: string): string[] {
  const affected = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of d.nodes) if (!affected.has(node.id) && graphDependencies(node).some(id => affected.has(id))) { affected.add(node.id); changed = true; }
  }
  affected.delete(nodeId);
  return current(s).filter(m => affected.has(String(s.stages.find(stage => stage.id === m.stage_id)?.node_id))).map(m => m.id).sort();
}
function graphCorrectionImpact(s: CommandSnapshot, d: GraphDefinition, source: StorageRow, outcome: CorrectedOutcome): string[] {
  const sourceNode = String(s.stages.find(stage => stage.id === source.stage_id)?.node_id);
  const possible = new Set(graphDependents(s, d, sourceNode));
  if (!possible.size) return [];
  const rosterOutput = record(s.stages.find(stage => stage.module_id === 'entries')?.output);
  const ids = rosterOutput.entryIds as string[];
  const matches = current(s).filter(m => !possible.has(m.id)).map(m => m.id === source.id ? { ...m, ...outcome, result_revision: Number(s.event!.revision) + 1 } : m);
  const stageInputs: GraphRuntimeOptions['stageInputs'] = Object.fromEntries(s.stages.map(stage => [String(stage.node_id), { inputRevision: Math.max(0, ...matches.filter(m => m.stage_id === stage.id).map(m => Number(m.result_revision ?? 0))), rankingDraws: record(stage.output).rankingDraws as RuntimeOptions['rankingDraws'] }]));
  const results: FixtureResult[] = matches.filter(m => m.outcome_kind).map(m => ({ fixtureId: String(m.logical_key), accepted: accepted(m), outcome: m.outcome_kind as OutcomeKind, winnerEntryId: m.winner_team_id as string | null, scoreA: m.score_a as number | null, scoreB: m.score_b as number | null }));
  const analysis = analyzeGraph(d, ids.map(id => ({ id, playerIds: entryPlayerIds(s, id) })), results, { seedAssignments: rosterOutput.seedAssignments as GraphRuntimeOptions['seedAssignments'], stageInputs, eligibleEntryIds: s.teams.filter(t => t.entry_state === 'approved').map(t => t.id), excludedByNode: rosterOutput.excludedByNode as Record<string, string[]> | undefined });
  const changed = new Set<string>();
  for (const node of d.nodes.filter(n => graphDependencies(n).includes(sourceNode))) {
    const affected = analysis.resolvedFixtures.filter(f => f.fixture.stageId === node.id).some(f => {
      const old = current(s).find(m => m.logical_key === f.fixture.id);
      return old && (old.team_a_id !== (f.entryA ?? null) || old.team_b_id !== (f.entryB ?? null));
    });
    if (affected) {
      for (const m of current(s).filter(m => s.stages.find(stage => stage.id === m.stage_id)?.node_id === node.id)) changed.add(m.id);
      for (const id of graphDependents(s, d, node.id)) changed.add(id);
    }
  }
  return [...changed].sort();
}
/** Candidate seed analysis intentionally omits dependent outcomes: those are impact-reviewed separately. */
function candidate(s: CommandSnapshot, source: StorageRow, outcome: CorrectedOutcome) {
  const d = definition(s), rosterStage = s.stages.find(stage => stage.module_id === 'entries')!;
  const rosterOutput = record(rosterStage.output), ids = rosterOutput.entryIds as string[];
  const roster = ids.map(id => ({ id, playerIds: entryPlayerIds(s, id) }));
  const rrStage = s.stages.find(stage => stage.module_id === 'round_robin'), rankStage = s.stages.find(stage => stage.module_id === 'standings');
  const matches = current(s).filter(m => m.stage_id === rrStage?.id).map(m => m.id === source.id ? { ...m, ...outcome, result_revision: Number(s.event!.revision) + 1 } : m);
  const results: FixtureResult[] = matches.filter(m => m.outcome_kind).map(m => ({ fixtureId: String(m.logical_key), accepted: accepted(m), outcome: m.outcome_kind as OutcomeKind, scoreA: m.score_a as number | null, scoreB: m.score_b as number | null, winnerEntryId: m.winner_team_id as string | null }));
  const options: RuntimeOptions = { rosterRevision: Number(s.event!.roster_revision), inputRevision: Math.max(0, ...matches.map(m => Number(m.result_revision ?? 0))), rankingDraws: record(rankStage?.output).rankingDraws as RuntimeOptions['rankingDraws'], roundRobinExclusions: rosterOutput.roundRobinExclusions as string[] | undefined, eligibleEntryIds: s.teams.filter(t => t.entry_state === 'approved').map(t => t.id) };
  return { analysis: analyzeTournament(d, roster, results, options), roster, options };
}
export interface CorrectionPreview {
  preview_hash: string; event_revision: number; source_match_id: string; source_result_revision: number;
  outcome: CorrectedOutcome; affected_match_ids: string[]; started_dependent_ids: string[];
  next_qualifier_ids?: string[]; qualification_pending?: boolean; requires_reopen: boolean;
}
export function previewCorrection(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>): CorrectionPreview {
  keys(data, ['match_id', 'score_a', 'score_b', 'outcome_kind', 'winner_entry_id']); authorized(snapshot, actor);
  const source = current(snapshot).find(m => m.id === ref(data.match_id));
  if (!source || !accepted(source)) return fail('INVALID_STATE', 'Only an accepted current result can be corrected.');
  const outcome = normalize(snapshot, source, data), d = definition(snapshot);
  let initial: string[] = [], nextQualifiers: string[] | undefined, qualificationPending = false;
  const stage = snapshot.stages.find(s => s.id === source.stage_id);
  if (d.schema_version === '2.0') initial = graphCorrectionImpact(snapshot, d, source, outcome);
  else if (stage?.module_id === 'round_robin' && d.nodes.some(n => n.module === 'qualify@1')) {
    const { analysis, roster, options } = candidate(snapshot, source, outcome);
    const q = d.nodes.find(n => n.module === 'qualify@1')!;
    const elimination = d.nodes.find(n => n.module === 'elimination@1')!;
    if (q.module === 'qualify@1' && elimination.module === 'elimination@1') {
      const ranked = analysis.standings.filter(row => options.eligibleEntryIds!.includes(row.entryId)).map(row => row.entryId);
      qualificationPending = analysis.ties.some(group => group.some(id => ranked.slice(0, q.config.count).includes(id)));
      const previous = record(snapshot.stages.find(s => s.module_id === 'qualify')?.output).entryIds as string[] | undefined;
      const seeds = [...ranked.slice(0, q.config.count), ...(previous ?? []).filter(id => !ranked.slice(0, q.config.count).includes(id))].slice(0, q.config.count);
      if (!qualificationPending && seeds.length === q.config.count) nextQualifiers = seeds;
      if (seeds.length === q.config.count) {
        const predicted = generateElimination(seeds.map(id => roster.find(e => e.id === id)!), d.event.courts, { ...elimination.config, stageId: elimination.id });
        for (const fixture of predicted.filter(f => f.round === 1)) {
          const old = current(snapshot).find(m => m.logical_key === fixture.id); if (!old) continue;
          const changed = ([['a', fixture.a], ['b', fixture.b]] as const).some(([side, slot]) => slot.kind === 'entry' && (analysis.ties.some(group => group.includes(slot.entryId)) || old[`team_${side}_id`] !== (options.eligibleEntryIds!.includes(slot.entryId) ? slot.entryId : null)));
          if (changed) initial.push(old.id);
        }
      } else initial = current(snapshot).filter(m => snapshot.stages.find(s => s.id === m.stage_id)?.module_id === 'elimination').map(m => m.id);
    }
  } else if (source.winner_team_id !== outcome.winner_team_id || source.outcome_kind === 'no_contest' || outcome.outcome_kind === 'no_contest') initial = [source.bracket_next_winner_match_id, source.bracket_next_loser_match_id].filter(Boolean).map(String);
  const affected = descendants(snapshot, initial);
  const payload = { event_revision: Number(snapshot.event!.revision), source_match_id: source.id, source_result_revision: Number(source.result_revision ?? 0), outcome, affected_match_ids: affected, started_dependent_ids: affected.filter(id => { const m = snapshot.matches.find(row => row.id === id)!; return Boolean(m.started_at) || accepted(m); }), ...(nextQualifiers ? { next_qualifier_ids: nextQualifiers } : {}), ...(qualificationPending ? { qualification_pending: true } : {}), requires_reopen: snapshot.event!.modular_state === 'completed' };
  return { ...payload, preview_hash: definitionHash(payload) };
}
export function planCorrection(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  keys(data, ['match_id', 'score_a', 'score_b', 'outcome_kind', 'winner_entry_id', 'preview_hash', 'reason', 'resolution']);
  const proposed = Object.fromEntries(Object.entries(data).filter(([key]) => ['match_id', 'score_a', 'score_b', 'outcome_kind', 'winner_entry_id'].includes(key)));
  const preview = previewCorrection(snapshot, actor, proposed); reason(data.reason);
  if (snapshot.event!.modular_state !== 'active') fail('INVALID_STATE', 'The owner must reopen completed results before committing a correction.');
  if (data.preview_hash !== preview.preview_hash) fail('STALE_PREVIEW', 'Recompute correction impact for the current revision.');
  if (!['ordinary', 'void_and_replay'].includes(String(data.resolution))) fail('INVALID_REQUEST', 'Choose ordinary or explicit void-and-replay.');
  if (preview.started_dependent_ids.length && data.resolution !== 'void_and_replay') fail('DOWNSTREAM_STARTED', 'Explicit void-and-replay is required for the affected started results.');
  const revision = Number(snapshot.event!.revision) + 1, now = new Date(context.now).toISOString();
  const archive = data.resolution === 'void_and_replay' || preview.qualification_pending ? preview.affected_match_ids : [];
  const matches: StorageRow[] = archive.map(id => { const old = snapshot.matches.find(m => m.id === id)!; return { id, is_current: false, voided_at: now, ...(old.started_at && !old.ended_at ? { ended_at: now } : {}) }; });
  matches.push({ id: preview.source_match_id, ...preview.outcome, status: preview.outcome.outcome_kind === 'walkover' ? 'walkover' : 'validated', validated_by: actor.id, result_revision: revision, revision });
  const stages: StorageRow[] = [];
  const roster = snapshot.stages.find(s => s.module_id === 'entries')!;
  stages.push({ id: roster.id, output: { ...record(roster.output), qualificationUnderReview: Boolean(preview.qualification_pending), ...(record(roster.output).qualifierSlots && preview.next_qualifier_ids ? { qualifierSlots: preview.next_qualifier_ids } : {}) } });
  if (preview.next_qualifier_ids) { const q = snapshot.stages.find(s => s.module_id === 'qualify'); if (q) stages.push({ id: q.id, output: { ...record(q.output), entryIds: preview.next_qualifier_ids } }); }
  return { effects: { matches, stages }, result: { source_match_id: preview.source_match_id, affected_match_ids: preview.affected_match_ids, replayed_match_ids: archive } };
}
export type WithdrawalTiming = 'before_lock' | 'locked_before_play' | 'incomplete_round_robin' | 'completed_rr_before_playoff' | 'playoffs_started' | 'direct_elimination';
export interface WithdrawalPreview { preview_hash: string; event_revision: number; entry_id: string; reason: string; timing: WithdrawalTiming; affected_match_ids: string[]; preserved_match_ids: string[]; next_qualifier_ids?: string[]; empty_qualifier_slots?: boolean }
export function previewWithdrawal(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>): WithdrawalPreview {
  keys(data, ['entry_id', 'reason']); const entryId = ref(data.entry_id), why = reason(data.reason); authorized(snapshot, actor, entryId);
  if (snapshot.event!.modular_state === 'completed') fail('INVALID_STATE', 'Owner must reopen completed results first.');
  const team = snapshot.teams.find(t => t.id === entryId);
  if (!team || !['approved', 'pending'].includes(String(team.entry_state))) fail('INVALID_STATE', 'Entry is not eligible for a new withdrawal.');
  const d = definition(snapshot);
  const active = current(snapshot), rr = snapshot.stages.find(s => ['round_robin', 'cross_play'].includes(String(s.module_id)) && (d.schema_version !== '2.0' || active.some(m => m.stage_id === s.id && [m.team_a_id, m.team_b_id].includes(entryId)))), elimination = snapshot.stages.find(s => s.module_id === 'elimination');
  const rrMatches = active.filter(m => m.stage_id === rr?.id);
  const rrComplete = rrMatches.length > 0 && rrMatches.every(accepted);
  const playoffStarted = d.schema_version === '2.0' && rr ? graphDependents(snapshot, d, String(rr.node_id)).some(id => { const m = active.find(m => m.id === id)!; return m.started_at || accepted(m); }) : active.some(m => m.stage_id === elimination?.id && (m.started_at || accepted(m)));
  const beforeLock = ['registration_open', 'registration_closed'].includes(String(snapshot.event!.modular_state));
  const timing: WithdrawalTiming = beforeLock ? 'before_lock' : !active.some(m => m.started_at || accepted(m)) ? 'locked_before_play' : playoffStarted ? 'playoffs_started' : rr && !rrComplete ? 'incomplete_round_robin' : rrComplete ? 'completed_rr_before_playoff' : 'direct_elimination';
  const involving = active.filter(m => [m.team_a_id, m.team_b_id].includes(entryId));
  const affected = timing === 'locked_before_play' ? active.map(m => m.id).sort() : descendants(snapshot, involving.filter(m => !accepted(m) || timing === 'incomplete_round_robin').map(m => m.id));
  const payload: Omit<WithdrawalPreview, 'preview_hash'> = { event_revision: Number(snapshot.event!.revision), entry_id: entryId, reason: why, timing, affected_match_ids: affected, preserved_match_ids: involving.filter(m => accepted(m) && timing !== 'incomplete_round_robin').map(m => m.id).sort() };
  if (timing === 'completed_rr_before_playoff' && elimination) {
    const q = snapshot.stages.find(s => s.module_id === 'qualify'), ranking = snapshot.stages.find(s => s.module_id === 'standings');
    if (q && ranking) {
      const previous = record(q.output).entryIds as string[];
      const rows = record(ranking.output).rows as { entryId: string }[];
      const eligible = rows.filter(row => row.entryId !== entryId && snapshot.teams.some(t => t.id === row.entryId && t.entry_state === 'approved')).map(row => row.entryId).slice(0, previous.length);
      payload.empty_qualifier_slots = eligible.length < previous.length;
      payload.next_qualifier_ids = [...eligible, ...previous.filter(id => !eligible.includes(id))].slice(0, previous.length);
    }
  }
  return { ...payload, preview_hash: definitionHash(payload) };
}
export function planWithdrawal(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  keys(data, ['entry_id', 'reason', 'preview_hash']);
  const preview = previewWithdrawal(snapshot, actor, { entry_id: data.entry_id, reason: data.reason });
  if (preview.preview_hash !== data.preview_hash) fail('STALE_PREVIEW', 'Recompute withdrawal impact for the current revision.');
  const now = new Date(context.now).toISOString(), revision = Number(snapshot.event!.revision) + 1;
  const before = ['before_lock', 'locked_before_play'].includes(preview.timing);
  const team = snapshot.teams.find(t => t.id === preview.entry_id)!;
  const effects: CommandPlan['effects'] = { teams: [{ id: team.id, entry_state: before ? 'cancelled' : 'withdrawn', eligibility_version: Number(team.eligibility_version ?? 0) + 1, withdrawn_at: now, withdrawal_reason: preview.reason }], team_members: [], tournament_players: [], matches: [], stages: [] };
  for (const member of snapshot.team_members.filter(m => m.team_id === team.id)) {
    effects.team_members!.push({ id: member.id, membership_status: before ? 'cancelled' : 'withdrawn' });
    const player = snapshot.tournament_players.find(p => p.user_id === member.user_id);
    if (player) effects.tournament_players!.push({ id: player.id, status: 'rejected', exit_reason: 'withdrew', nullified_from_standings: preview.timing === 'incomplete_round_robin' });
  }
  const active = current(snapshot);
  if (before) {
    effects.event = { roster_revision: Number(snapshot.event!.roster_revision) + 1 };
    if (preview.timing === 'locked_before_play') {
      effects.event.modular_state = 'registration_closed';
      effects.matches = active.map(m => ({ id: m.id, is_current: false }));
      effects.rounds = snapshot.rounds.filter(r => r.is_current !== false).map(r => ({ id: r.id, is_current: false }));
      effects.stages = snapshot.stages.map(stage => ({ id: stage.id, state: stage.module_id === 'registration' ? 'completed' : 'waiting', output: {}, blocked_code: null }));
    }
  } else {
    const roster = snapshot.stages.find(s => s.module_id === 'entries')!, output = record(roster.output);
    if (preview.timing === 'incomplete_round_robin') {
      if (definition(snapshot).schema_version === '2.0') {
        const pools = snapshot.stages.filter(stage => ['round_robin', 'cross_play'].includes(String(stage.module_id)) && active.some(m => m.stage_id === stage.id && [m.team_a_id, m.team_b_id].includes(team.id)));
        const excludedByNode = { ...record(output.excludedByNode) };
        for (const pool of pools) excludedByNode[String(pool.node_id)] = [...new Set([...(excludedByNode[String(pool.node_id)] as string[] ?? []), team.id])];
        effects.stages!.push({ id: roster.id, output: { ...output, excludedByNode } });
      } else effects.stages!.push({ id: roster.id, output: { ...output, roundRobinExclusions: [...new Set([...(output.roundRobinExclusions as string[] ?? []), team.id])] } });
    } else if (preview.empty_qualifier_slots) effects.stages!.push({ id: roster.id, output: { ...output, qualifierSlots: preview.next_qualifier_ids } });
    if (preview.next_qualifier_ids) { const q = snapshot.stages.find(s => s.module_id === 'qualify')!; effects.stages!.push({ id: q.id, output: { ...record(q.output), entryIds: preview.next_qualifier_ids } }); }
    const rr = snapshot.stages.find(s => ['round_robin', 'cross_play'].includes(String(s.module_id)) && (definition(snapshot).schema_version !== '2.0' || active.some(m => m.stage_id === s.id && [m.team_a_id, m.team_b_id].includes(team.id))));
    for (const match of active.filter(m => [m.team_a_id, m.team_b_id].includes(team.id))) {
      const excluded = preview.timing === 'incomplete_round_robin' && match.stage_id === rr?.id ? { excluded_at: now } : {};
      if (accepted(match)) { if (Object.keys(excluded).length) effects.matches!.push({ id: match.id, ...excluded }); continue; }
      if (match.status === 'in_progress') {
        const opponent = match.team_a_id === team.id ? match.team_b_id : match.team_a_id;
        const winner = snapshot.teams.some(t => t.id === opponent && t.entry_state === 'approved') ? opponent : null;
        effects.matches!.push({ id: match.id, ...excluded, status: 'validated', outcome_kind: winner ? 'retirement' : 'no_contest', winner_team_id: winner, score_a: null, score_b: null, ended_at: now, validated_by: actor.id, revision, result_revision: revision });
      } else if (preview.timing === 'incomplete_round_robin' && match.stage_id === rr?.id) effects.matches!.push({ id: match.id, ...excluded, status: 'validated', outcome_kind: 'no_contest', winner_team_id: null, score_a: null, score_b: null, revision, result_revision: revision, validated_by: actor.id });
    }
  }
  return { effects, result: { entry_id: team.id, timing: preview.timing, ...(preview.next_qualifier_ids ? { qualifier_ids: preview.next_qualifier_ids } : {}) } };
}
export function planCourtChange(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>): CommandPlan {
  keys(data, ['match_id', 'court_number']); authorized(snapshot, actor);
  if (!['ready', 'active'].includes(String(snapshot.event!.modular_state))) fail('INVALID_STATE', 'Courts can change only for a committed unstarted schedule.');
  const match = current(snapshot).find(m => m.id === ref(data.match_id));
  if (!match || match.status !== 'scheduled' || match.started_at) fail('INVALID_STATE', 'Only unstarted fixtures can move.');
  const courts = definition(snapshot).event.courts;
  if (!Number.isInteger(data.court_number) || Number(data.court_number) < 1 || Number(data.court_number) > courts) fail('INVALID_REQUEST', 'Choose a configured court.');
  const wave = snapshot.rounds.find(r => r.id === match!.round_id)?.logical_wave;
  if (current(snapshot).some(m => m.id !== match!.id && m.court_number === data.court_number && (m.status === 'in_progress' || snapshot.rounds.find(r => r.id === m.round_id)?.logical_wave === wave))) fail('COURT_BUSY', 'Another fixture occupies this court in that wave.');
  return { effects: { matches: [{ id: match!.id, court_number: data.court_number }] }, result: { match_id: match!.id, court_number: data.court_number } };
}
