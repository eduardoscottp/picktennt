import type { CommandActor, CommandEffects, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { planInternalRuntime } from './commands';
import { planGraphRuntime } from './graph-command-runtime';
import { isEligibleEntry } from './disciplinary-eligibility';
import { entryPlayerIds } from './entry-roster';
import { resolvedDefinition } from './resolved-definition';
import { validateDraft } from './validate';
import { analyzeTournament } from './runtime';
import { definitionHash, DomainError, UUID } from './requests';
import type { FixtureResult, RuntimeOptions } from './types';

export const TEAM_FORFEIT_POLICY = 'all_matches_0_11';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const current = (match: StorageRow) => match.is_current !== false && !match.voided_at;
const started = (match: StorageRow) => Boolean(match.started_at) || match.status !== 'scheduled' || match.score_a != null || match.score_b != null;
const facts = (match: StorageRow) => Object.fromEntries(['id','team_a_id','team_b_id','status','outcome_kind','winner_team_id','score_a','score_b','started_at','ended_at','result_revision','submit_to_dupr'].map(key => [key, match[key] ?? null])) as StorageRow;

function build(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, now: string) {
  const event = snapshot.event;
  if (!event || actor.clientId !== 'web' || !(event.created_by === actor.id || actor.role === 'admin')) fail('FORBIDDEN', 'Use the tournament administrator page to withdraw a team.');
  if (!['active','completed'].includes(String(event!.modular_state))) fail('INVALID_STATE', 'The tournament must have started. Use roster removal before it starts.');
  if (event!.modular_state === 'completed' && actor.id !== event!.created_by) fail('FORBIDDEN', 'Only the owner can change completed results.');
  const rawReason = typeof data.reason === 'string' ? data.reason : '', reason = rawReason.trim();
  if (data.policy !== TEAM_FORFEIT_POLICY || typeof data.entry_id !== 'string' || !UUID.test(data.entry_id) || !reason || rawReason.length > 1000) fail('INVALID_REQUEST', 'Choose a team and provide a withdrawal reason.');
  const team = snapshot.teams.find(row => row.id === data.entry_id && row.entry_state === 'approved');
  if (!team) fail('INVALID_STATE', 'Choose an active approved team.');
  const selected = snapshot.matches.filter(match => current(match) && [match.team_a_id,match.team_b_id].includes(team!.id));
  if (!selected.length) fail('INVALID_STATE', 'There are no current games for this team.');
  for (const match of selected) {
    const opponent = match.team_a_id === team!.id ? match.team_b_id : match.team_a_id;
    if (!opponent) fail('UNRESOLVED_OPPONENT', 'A game has no resolved opponent. Review its dependencies before withdrawing this team.');
    if (!snapshot.teams.some(row => row.id === opponent && isEligibleEntry(snapshot,row))) fail('OPPONENT_WITHDRAWN', 'An opponent is already withdrawn or ineligible. Review these results manually; both teams cannot lose the same game 0–11.');
  }
  const definition = validateDraft(resolvedDefinition(snapshot)?.definition, { registration: true }).definition ?? fail('INVALID_DEFINITION', 'A supported tournament definition is required.');
  const work = structuredClone(snapshot), revision = Number(event!.revision) + 1;
  const effects: CommandEffects = { event: { modular_state: 'active', results_under_review: true, completed_at: null }, teams: [{ id: team!.id, entry_state: 'withdrawn', eligibility_version: Number(team!.eligibility_version ?? 0) + 1, withdrawn_at: now, withdrawal_reason: reason }], team_members: [], tournament_players: [], matches: [], stages: [] };
  for (const member of work.team_members.filter(row => row.team_id === team!.id && ['active','pending'].includes(String(row.membership_status)))) {
    effects.team_members!.push({ id: member.id, membership_status: 'withdrawn' });
    const player = work.tournament_players.find(row => row.user_id === member.user_id);
    if (player) effects.tournament_players!.push({ id: player.id, status: 'rejected', exit_reason: 'withdrew', nullified_from_standings: false });
  }
  for (const match of selected) effects.matches!.push({ id: match.id, status: 'validated', outcome_kind: 'administrative_score', winner_team_id: match.team_a_id === team!.id ? match.team_b_id : match.team_a_id, score_a: match.team_a_id === team!.id ? 0 : 11, score_b: match.team_b_id === team!.id ? 0 : 11, submit_to_dupr: false, excluded_at: null, submitted_entry_id: null, entered_by: null, validated_by: actor.id, ended_at: match.started_at ? match.ended_at ?? now : match.ended_at ?? null, result_revision: revision, revision });
  const roster = work.stages.find(stage => stage.module_id === 'entries')!;
  const output = record(roster.output);
  const nextOutput = { ...output, roundRobinExclusions: (output.roundRobinExclusions as string[] ?? []).filter(id => id !== team!.id), excludedByNode: Object.fromEntries(Object.entries(record(output.excludedByNode)).map(([node,ids]) => [node,(ids as string[]).filter(id => id !== team!.id)])) };
  effects.stages!.push({ id: roster.id, output: nextOutput });
  Object.assign(work.event!, effects.event);
  for (const table of ['teams','team_members','tournament_players','matches','stages'] as const) for (const patch of effects[table] ?? []) Object.assign(work[table].find(row => row.id === patch.id)!, patch);
  // Recompute qualification independently before accepting any downstream history.
  if (definition.schema_version !== '2.0' && definition.nodes.some(node => node.module === 'qualify@1')) {
    const rr = work.stages.find(stage => stage.module_id === 'round_robin')!;
    const elimination = work.stages.find(stage => stage.module_id === 'elimination')!;
    const ids = output.entryIds as string[];
    const matches = work.matches.filter(match => current(match) && match.stage_id === rr.id);
    const results: FixtureResult[] = matches.filter(match => match.outcome_kind).map(match => ({ fixtureId: String(match.logical_key), accepted: ['validated','walkover'].includes(String(match.status)), outcome: match.outcome_kind as FixtureResult['outcome'], winnerEntryId: match.winner_team_id as string | null, scoreA: match.score_a as number | null, scoreB: match.score_b as number | null }));
    const ranking = work.stages.find(stage => stage.module_id === 'standings');
    const options: RuntimeOptions = { allowIncompleteRoster: true, rosterRevision: Number(event!.roster_revision), inputRevision: Math.max(0,...matches.map(match => Number(match.result_revision ?? 0))), eligibleEntryIds: work.teams.filter(row => isEligibleEntry(work,row)).map(row => row.id), rankingDraws: record(ranking?.output).rankingDraws as RuntimeOptions['rankingDraws'], roundRobinExclusions: nextOutput.roundRobinExclusions };
    const analysis = analyzeTournament(definition, ids.map(id => ({ id, playerIds: entryPlayerIds(work,id) })), results, options);
    const prior = record(work.stages.find(stage => stage.module_id === 'qualify')?.output).entryIds;
    if (JSON.stringify(prior ?? []) !== JSON.stringify(analysis.qualifiers) && work.matches.some(match => current(match) && match.stage_id === elimination.id && started(match))) fail('DOWNSTREAM_STARTED', 'The withdrawal changes qualification for games already played. Review those results manually before withdrawing.');
    if (!work.matches.some(match => current(match) && match.stage_id === elimination.id && started(match))) {
      Object.assign(nextOutput, { qualifierSlots: null, qualificationUnderReview: true });
      roster.output = nextOutput;
    }
  }
  const seed = definitionHash({ event_id: event!.id, revision: event!.revision, entry_id: team!.id, policy: data.policy });
  let counter = 0;
  const id = () => { const hash = definitionHash({ seed, counter: counter++ }); return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`; };
  let runtime: CommandPlan;
  try {
    runtime = definition.schema_version === '2.0' ? planGraphRuntime(work,definition,actor,{now,id},revision) : planInternalRuntime(work,actor,{now,id});
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error instanceof Error && /winner|participating|feeder|accepted outcome|placement|illegal/i.test(error.message)) fail('DOWNSTREAM_STARTED','This withdrawal changes existing match dependencies. Review the affected results manually.');
    throw error;
  }
  const bracket = runtime.effects.stages?.find(stage => work.stages.find(old => old.id === stage.id)?.module_id === 'elimination');
  for (const resolved of (record(bracket?.output).fixtures ?? []) as {fixture:{id:string};entryA?:string|null;entryB?:string|null}[]) {
    const match = work.matches.find(row => current(row) && row.logical_key === resolved.fixture.id);
    if (match && started(match) && (match.team_a_id !== (resolved.entryA ?? null) || match.team_b_id !== (resolved.entryB ?? null))) fail('DOWNSTREAM_STARTED','A changed bracket would replace participants of an already recorded game. Review the dependency manually.');
  }
  for (const table of ['stages','rounds','matches','standings'] as const) for (const patch of runtime.effects[table] ?? []) {
    const patches = effects[table] ??= [], previous = patches.find(row => row.id === patch.id);
    if (previous) Object.assign(previous,patch); else patches.push(patch);
  }
  effects.event = { ...effects.event, ...runtime.effects.event };
  if (runtime.effects.replace_standings_stage_ids) effects.replace_standings_stage_ids = runtime.effects.replace_standings_stage_ids;
  const proposed = selected.map(match => ({ ...facts(match), ...effects.matches!.find(patch => patch.id === match.id)! }));
  const changed = (effects.matches ?? []).filter(patch => !selected.some(match => match.id === patch.id)).map(patch => ({ ...facts(snapshot.matches.find(row => row.id === patch.id) ?? patch), ...patch }));
  const proposedFacts = (match: StorageRow) => { const result = facts(match); delete result.started_at; delete result.ended_at; return result; };
  const impact = { event_revision: Number(event!.revision), entry_id: team!.id, reason, policy: TEAM_FORFEIT_POLICY, timing: 'all_matches_forfeit' as const, affected_match_ids: selected.map(match => match.id).sort(), affected_matches: selected.map(facts), proposed_matches: proposed.map(proposedFacts), changed_fixtures: changed.map(proposedFacts), preserved_match_ids: snapshot.matches.filter(match => current(match) && !selected.some(item => item.id === match.id)).map(match => match.id).sort(), preserved_matches: [] as StorageRow[], requires_reopen: false, reopens_completed_results: event!.modular_state === 'completed', round_robin_results_excluded: false, dupr_history_unknown: selected.some(match => match.outcome_kind === 'played'), projected_standings: (effects.standings ?? []).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'))) };
  return { effects, impact, hash: definitionHash(impact), result: { entry_id: team!.id, policy: TEAM_FORFEIT_POLICY, affected_match_ids: impact.affected_match_ids, ...runtime.result } };
}

export function previewTeamForfeit(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (Object.keys(data).some(key => !['entry_id','reason','policy'].includes(key))) fail('INVALID_REQUEST','Unknown withdrawal field.');
  const operation = build(snapshot,actor,data,'2000-01-01T00:00:00.000Z');
  return { ...operation.impact, preview_hash: operation.hash };
}
export function planTeamForfeit(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, now: string): CommandPlan {
  if (Object.keys(data).some(key => !['entry_id','reason','policy','preview_hash','confirmed_forfeit'].includes(key))) fail('INVALID_REQUEST','Unknown withdrawal field.');
  if (data.confirmed_forfeit !== true) fail('CONFIRMATION_REQUIRED','Confirm that every past and future game for this team will be a 0–11 loss.');
  const operation = build(snapshot,actor,data,now);
  if (data.preview_hash !== operation.hash) fail('STALE_PREVIEW','The tournament changed. Review the complete withdrawal impact again.');
  return { effects: operation.effects, result: operation.result };
}
