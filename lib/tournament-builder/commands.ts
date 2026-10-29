import { guestPlayers, entryPlayerIds } from './entry-roster';
import { isOwnerAction, requireReviewedOwnerAction } from './owner-actions';
import { planGraphRuntime } from './graph-command-runtime';
import { finalizeGraph, assignGroupSlots } from './group-finalization';
import { resolvedDefinition } from './resolved-definition';
import { planRevision, planEventDetails } from './revisions';
import { previewSchedule, generationOrder } from './schedule-preview';
export type StorageRow = { id: string } & Record<string, unknown>;
export interface CommandSnapshot { event: StorageRow | null; definitions: StorageRow[]; teams: StorageRow[]; team_members: StorageRow[]; tournament_players: StorageRow[]; stages: StorageRow[]; rounds: StorageRow[]; matches: StorageRow[]; standings: StorageRow[]; admins?: StorageRow[] }
export interface CommandActor { id: string; clientId: string; grantId?: string; role?: 'owner' | 'admin' | 'player'; permissions?: readonly string[] }
export interface CommandContext { now: string; id: () => string; draw?: (entryIds: readonly string[]) => string[] }
export interface CommandEffects { event?: Record<string, unknown>; definition?: StorageRow; teams?: StorageRow[]; team_members?: StorageRow[]; tournament_players?: StorageRow[]; stages?: StorageRow[]; rounds?: StorageRow[]; matches?: StorageRow[]; standings?: StorageRow[]; replace_standings_stage_ids?: string[]; admin_change?: { action: 'add' | 'remove'; id: string; user_id: string } }
export interface CommandPlan { effects: CommandEffects; result: Record<string, unknown> }
const fields: Record<string, readonly string[]> = {
  createDraft: ['definition'], updateDraft: ['definition'], publishTournament: ['reviewed_definition_hash', 'acknowledged_warning_codes', 'confirmed_owner_action', 'reviewed_action_hash'],
  reviseTournament: ['definition', 'entries', 'reason', 'preview_hash'], updateEventDetails: ['name', 'venue_name', 'reason'],
  requestEntry: ['definition_id', 'consent', 'partner_id', 'entry_name'], acceptPartner: ['entry_id', 'definition_id', 'consent'],
  addGuestEntry: ['definition_id', 'player_names', 'reason'],
  addRegisteredEntry: ['definition_id', 'player_ids', 'entry_name', 'reason'],
  addAdministrator: ['user_id', 'reason', 'confirmed_owner_action', 'reviewed_action_hash'], removeAdministrator: ['user_id', 'reason', 'confirmed_owner_action', 'reviewed_action_hash'],
  approveEntry: ['entry_id'], rejectEntry: ['entry_id', 'reason'], cancelEntry: ['entry_id'],
  closeRegistration: [], reopenRegistration: [], lockRoster: ['reviewed_roster_revision', 'nodes', 'group_assignments', 'preview_hash'], startTournament: [],
  startMatch: ['match_id', 'rest_override_reason'], submitScore: ['match_id', 'score_a', 'score_b'], confirmScore: ['match_id', 'result_revision'],
  disputeScore: ['match_id', 'result_revision', 'reason'], attestScore: ['match_id', 'score_a', 'score_b', 'outcome_kind', 'winner_entry_id', 'reason'],
  adjudicateDispute: ['match_id', 'score_a', 'score_b', 'outcome_kind', 'winner_entry_id', 'reason'],
  resolveTie: ['stage_id', 'entry_ids', 'input_revision'], reopenResults: ['reason', 'confirmed_owner_action', 'reviewed_action_hash'], cancelTournament: ['reason', 'confirmed_owner_action', 'reviewed_action_hash'],
  commitCorrection: ['match_id', 'score_a', 'score_b', 'outcome_kind', 'winner_entry_id', 'preview_hash', 'reason', 'resolution'],
  withdrawEntry: ['entry_id', 'reason', 'preview_hash'], changeCourt: ['match_id', 'court_number'],
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fail = (code: string, message: string, details?: unknown): never => { throw new DomainError(code, message, details); };
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail('INVALID_REQUEST', `Specify ${label}.`);
  return value.trim();
}
function reference(value: unknown, label: string): string {
  const id = text(value, label);
  if (!UUID.test(id)) return fail('INVALID_REQUEST', `${label} must be a UUID.`);
  return id;
}
function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail('INVALID_REQUEST', `${label} must be a nonnegative integer.`);
  return Number(value);
}
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string') || new Set(value).size !== value.length) return fail('INVALID_REQUEST', `${label} must contain unique strings.`);
  return [...value];
}

/** Trusted server planner only. Auth, current grants, receipt replay and CAS are rechecked by the SQL boundary.
 * Actor.role comes from server membership, never command data. IDs/draws/time are injected server capabilities.
 */
export function planCommand(snapshot: CommandSnapshot, actor: CommandActor, command: string, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  if (!actor.id || !actor.clientId) return fail('UNAUTHENTICATED', 'Sign in before issuing a command.');
  if (!Object.hasOwn(fields, command)) return fail('INVALID_COMMAND', 'Unsupported command.');
  if (!data || Array.isArray(data) || Object.keys(data).some(key => !fields[command].includes(key))) return fail('INVALID_REQUEST', 'Command contains unknown fields.');
  if (command === 'addGuestEntry') return fail('ACCOUNT_REQUIRED', 'Every player must have a Picktennt account. Register an existing player profile instead.');
  if (actor.clientId !== 'web' && !['createDraft', 'updateDraft'].includes(command) && !(isOwnerAction(command) ? actor.permissions?.includes('owner:manage') : actor.permissions?.includes('admin:manage'))) return fail('FORBIDDEN', 'Explicit permission is required for this assistant action.');
  const work = structuredClone(snapshot), effects: CommandEffects = {};
  work.stages = work.stages.filter(stage => !stage.definition_id || stage.definition_id === work.event?.definition_id);
  let result: Record<string, unknown> = {};
  const now = new Date(context.now);
  if (!Number.isFinite(now.getTime())) return fail('INVALID_REQUEST', 'Invalid server clock.');
  const iso = now.toISOString(), nextRevision = Number(work.event?.revision ?? 0) + 1;
  const owner = work.event?.created_by === actor.id;
  const admin = owner || actor.role === 'admin';
  const needAdmin = () => { if (!admin) fail('FORBIDDEN', 'Administrator permission required.'); };
  const needOwner = () => { if (!owner || (actor.clientId !== 'web' && !actor.permissions?.includes('owner:manage'))) fail('FORBIDDEN', 'Current owner permission required.'); };
  if (isOwnerAction(command) && (actor.clientId !== 'web' || ['addAdministrator', 'removeAdministrator'].includes(command))) { needOwner(); requireReviewedOwnerAction(snapshot, actor, command, data); }
  const state = (...allowed: string[]) => { if (!allowed.includes(String(work.event?.modular_state))) fail('INVALID_STATE', 'Command is not permitted in the current event state.'); };
  const event = (patch: Record<string, unknown>) => { effects.event = { ...effects.event, ...patch }; if (work.event) Object.assign(work.event, patch); };
  function put(table: 'teams' | 'team_members' | 'tournament_players' | 'stages' | 'rounds' | 'matches' | 'standings', patch: StorageRow) {
    const old = work[table].findIndex(row => row.id === patch.id);
    if (old >= 0) work[table][old] = { ...work[table][old], ...patch }; else work[table].push({ ...patch });
    const patches = effects[table] ??= [];
    const index = patches.findIndex(row => row.id === patch.id);
    if (index >= 0) patches[index] = { ...patches[index], ...patch }; else patches.push({ ...patch });
  }
  const currentDefinition = () => work.definitions.find(row => row.id === work.event?.definition_id) ?? work.definitions.at(-1);
  function definition(): TournamentDefinition {
    const validation = validateDraft(resolvedDefinition(work)?.definition, { registration: true });
    if (!validation.definition) return fail(validation.missing_fields.length ? 'MISSING_FIELDS' : 'INVALID_DEFINITION', 'A complete supported definition is required.', validation);
    return validation.definition;
  }
  function members(teamId: string): StorageRow[] { return work.team_members.filter(row => row.team_id === teamId && !['cancelled', 'withdrawn'].includes(String(row.membership_status))); }
  function ownEntry(match: StorageRow): string | undefined {
    return work.team_members.find(row => row.user_id === actor.id && row.membership_status === 'active' && [match.team_a_id, match.team_b_id].includes(row.team_id))?.team_id as string | undefined;
  }
  function match(): StorageRow {
    const row = work.matches.find(m => m.id === reference(data.match_id, 'match_id') && m.is_current !== false && !m.voided_at);
    if (!row) return fail('NOT_FOUND', 'Current match not found.');
    return row;
  }
  function entry(): StorageRow {
    return work.teams.find(row => row.id === reference(data.entry_id, 'entry_id')) ?? fail('NOT_FOUND', 'Entry not found.');
  }
  function admissionWindow(d: TournamentDefinition) { state('registration_open'); if (Date.parse(d.registration.closes_at) <= now.getTime()) fail('REGISTRATION_CLOSED', 'Registration deadline has passed.'); }
  function consent(d: TournamentDefinition) { if (data.consent !== true || data.definition_id !== currentDefinition()?.id) fail('INCOMPLETE_ROSTER', 'Accept the exact published definition explicitly.'); return d; }
  function complete(team: StorageRow, d: TournamentDefinition): boolean {
    const roster = members(team.id);
    const guests = guestPlayers(team);
    if (guests.length || team.guest_definition_id) return false;
    return roster.length === (d.registration.entry_type === 'singles' ? 1 : 2) && roster.every(m => (m.consented_definition_id === currentDefinition()?.id && m.consented_at) || (m.admission_source === 'administrator' && team.admin_definition_id === currentDefinition()?.id && team.registered_by));
  }
  function projectMember(member: StorageRow, status: 'pending' | 'approved' | 'rejected') {
    const row = work.tournament_players.find(p => p.user_id === member.user_id);
    put('tournament_players', { id: row?.id ?? context.id(), user_id: member.user_id, status, joined_via: 'link' });
  }
  function admit(team: StorageRow, d: TournamentDefinition): boolean {
    if (!complete(team, d)) return fail('INCOMPLETE_ROSTER', 'All actual partners must consent before admission.');
    for (const member of members(team.id)) if (work.team_members.some(m => m.user_id === member.user_id && m.team_id !== team.id && m.membership_status === 'active')) fail('DUPLICATE_ENTRY', 'A player is already in another active entry.');
    if (work.teams.filter(t => t.entry_state === 'approved' && t.id !== team.id).length >= d.registration.max_entries) return false;
    put('teams', { id: team.id, entry_state: 'approved' });
    for (const member of members(team.id)) { put('team_members', { id: member.id, membership_status: 'active' }); projectMember(member, 'approved'); }
    return true;
  }
  function bumpRoster() { event({ roster_revision: Number(work.event?.roster_revision ?? 0) + 1 }); }
  function draw(ids: readonly string[]): string[] {
    if (!context.draw) return fail('DRAW_REQUIRED', 'A server-generated draw is required.');
    const permutation = context.draw(ids);
    if (permutation.length !== ids.length || new Set(permutation).size !== ids.length || !ids.every(id => permutation.includes(id))) return fail('INVALID_REQUEST', 'Server draw must be an exact permutation.');
    return permutation;
  }

  function syncRuntime(depth = 0) {
    if (depth > 16) fail('INVALID_STATE', 'Bounded bracket propagation exceeded the supported size.');
    const d = definition();
    if (d.schema_version === '2.0') {
      const plan = planGraphRuntime(work, d, actor, context, nextRevision);
      if (plan.effects.event) event(plan.effects.event);
      for (const table of ['stages', 'rounds', 'matches', 'standings'] as const) for (const patch of plan.effects[table] ?? []) put(table, patch);
      result = { ...result, ...plan.result };
      return;
    }
    const rosterStage = work.stages.find(s => s.node_id === d.nodes.find(n => n.module === 'entries@1')!.id)!;
    const rosterOutput = record(rosterStage.output), rosterIds = strings(rosterOutput.entryIds, 'locked roster');
    const roster: TournamentEntry[] = rosterIds.map(id => ({ id, playerIds: entryPlayerIds(work, id) }));
    const activeMatches = work.matches.filter(m => m.is_current !== false && !m.voided_at);
    const rrNode = d.nodes.find(n => n.module === 'round_robin@1');
    const rrStage = work.stages.find(s => s.node_id === rrNode?.id);
    const rankingStage = work.stages.find(s => s.node_id === d.nodes.find(n => n.module === 'standings@1')?.id);
    const qualifyStage = work.stages.find(s => s.node_id === d.nodes.find(n => n.module === 'qualify@1')?.id);
    const eliminationStage = work.stages.find(s => s.node_id === d.nodes.find(n => n.module === 'elimination@1')?.id);
    const inputRevision = Math.max(0, ...activeMatches.filter(m => m.stage_id === rrStage?.id).map(m => Number(m.result_revision ?? 0)));
    const output = record(rankingStage?.output);
    const runtimeOptions: RuntimeOptions = {
      rosterRevision: Number(work.event!.roster_revision), inputRevision,
      eligibleEntryIds: work.teams.filter(t => rosterIds.includes(t.id) && t.entry_state === 'approved').map(t => t.id),
      directDraw: rosterOutput.directDraw as RuntimeOptions['directDraw'],
      rankingDraws: output.rankingDraws as RuntimeOptions['rankingDraws'],
      roundRobinExclusions: rosterOutput.roundRobinExclusions as string[] | undefined,
    };
    if (eliminationStage && activeMatches.some(m => m.stage_id === eliminationStage.id && (m.started_at || ['validated', 'walkover'].includes(String(m.status))))) {
      runtimeOptions.playoffsStarted = true;
      runtimeOptions.lockedQualifierIds = record(qualifyStage?.output).entryIds as string[] | undefined;
    }
    if (rosterOutput.qualifierSlots) runtimeOptions.lockedQualifierIds = rosterOutput.qualifierSlots as string[];
    const results: FixtureResult[] = activeMatches.filter(m => m.logical_key && (m.outcome_kind || ['score_entered', 'disputed'].includes(String(m.status)))).map(m => ({ fixtureId: String(m.logical_key), accepted: ['validated', 'walkover'].includes(String(m.status)), outcome: (m.outcome_kind ?? 'played') as OutcomeKind, winnerEntryId: m.winner_team_id as string | null, scoreA: m.score_a as number | null, scoreB: m.score_b as number | null }));
    let analysis;
    if (rosterOutput.qualificationUnderReview && eliminationStage) {
      const independent = { ...runtimeOptions, playoffsStarted: false, lockedQualifierIds: undefined };
      const candidate = analyzeTournament(d, roster, results.filter(r => !String(r.fixtureId).startsWith(`${String(eliminationStage.node_id)}:`)), independent);
      if (candidate.blockedCode === 'UNRESOLVED_TIE') analysis = candidate;
      else {
        runtimeOptions.lockedQualifierIds = candidate.qualifiers;
        analysis = analyzeTournament(d, roster, results, runtimeOptions);
        put('stages', { id: rosterStage.id, output: { ...rosterOutput, qualificationUnderReview: false } });
      }
    } else analysis = analyzeTournament(d, roster, results, runtimeOptions);
    const fixtureIds = new Map(analysis.fixtures.map(f => [f.id, activeMatches.find(m => m.logical_key === f.id)?.id ?? context.id()]));
    const pending: StorageRow[] = [];
    for (const fixture of analysis.fixtures) {
      const stage = work.stages.find(s => s.node_id === fixture.stageId)!;
      const resolved = analysis.bracket?.fixtures.find(f => f.fixture.id === fixture.id);
      const old = activeMatches.find(m => m.logical_key === fixture.id);
      const historical = old && ['validated', 'walkover'].includes(String(old.status));
      const a = historical ? old.team_a_id : resolved ? resolved.entryA ?? null : fixture.a.kind === 'entry' ? fixture.a.entryId : null;
      const b = historical ? old.team_b_id : resolved ? resolved.entryB ?? null : fixture.b.kind === 'entry' ? fixture.b.entryId : null;
      if (old && (old.team_a_id !== a || old.team_b_id !== b) && old.status !== 'scheduled') fail('DOWNSTREAM_STARTED', 'A changed dependency requires explicit impact review and replay.');
      const roundType = fixture.stageId === rrNode?.id ? 'round_robin' : fixture.bronze ? 'finals_bronze' : fixture.round === Math.max(...analysis.fixtures.filter(f => f.stageId === fixture.stageId).map(f => f.round)) ? 'finals_gold' : 'elimination';
      let round = old ? work.rounds.find(r => r.id === old.round_id) : work.rounds.find(r => r.stage_id === stage.id && r.logical_wave === fixture.wave && r.round_type === roundType && r.is_current !== false);
      if (!round) { round = { id: context.id(), stage_id: stage.id, logical_wave: fixture.wave, round_number: Math.max(0, ...work.rounds.map(r => Number(r.round_number))) + 1, round_type: roundType, status: 'pending', schedule_generation: work.event!.roster_revision, is_current: true }; put('rounds', round); }
      if (!old || old.team_a_id !== a || old.team_b_id !== b) pending.push({ id: fixtureIds.get(fixture.id)!, round_id: round.id, stage_id: stage.id, logical_key: fixture.id, court_number: old?.court_number ?? fixture.court, team_a_id: a, team_b_id: b, schedule_generation: work.event!.roster_revision, is_current: true, ...(old ? {} : { status: 'scheduled', revision: 0, result_revision: 0, submit_to_dupr: false }) });
    }
    // Insert successors first because legacy bracket-next FKs are immediate, then patch feeder links.
    for (const patch of pending.reverse()) put('matches', patch);
    for (const fixture of analysis.fixtures) for (const [side, slot] of [['a', fixture.a], ['b', fixture.b]] as const) if (slot.kind !== 'entry') {
      const feeder = work.matches.find(m => m.logical_key === slot.fixtureId && m.is_current !== false)!;
      const key = slot.kind === 'winner' ? 'bracket_next_winner_match_id' : 'bracket_next_loser_match_id';
      const fills = slot.kind === 'winner' ? 'bracket_winner_fills_side' : 'bracket_loser_fills_side';
      if (feeder[key] !== fixtureIds.get(fixture.id) || feeder[fills] !== side) put('matches', { id: feeder.id, [key]: fixtureIds.get(fixture.id), [fills]: side });
    }
    let automated = false;
    for (const fixture of analysis.bracket?.fixtures ?? []) if (fixture.state === 'ready' && fixture.requiredOutcome) {
      const row = work.matches.find(m => m.logical_key === fixture.fixture.id && m.is_current !== false)!;
      put('matches', { id: row.id, status: fixture.requiredOutcome === 'walkover' ? 'walkover' : 'validated', outcome_kind: fixture.requiredOutcome, winner_team_id: fixture.requiredOutcome === 'walkover' ? fixture.entryA ?? fixture.entryB : null, score_a: null, score_b: null, validated_by: actor.id, result_revision: nextRevision, revision: nextRevision });
      automated = true;
    }
    if (automated) { syncRuntime(depth + 1); return; }
    const rrDone = !rrStage || analysis.fixtures.filter(f => f.stageId === rrNode?.id).every(f => activeMatches.some(m => m.logical_key === f.id && ['validated', 'walkover'].includes(String(m.status))));
    for (const stage of work.stages) {
      const node = d.nodes.find(n => n.id === stage.node_id)!;
      const prior = record(stage.output);
      const payload = node.module === 'standings@1' ? { ...prior, inputRevision, rows: analysis.standings, ties: analysis.ties }
        : node.module === 'qualify@1' ? { ...prior, entryIds: rosterOutput.qualificationUnderReview && analysis.blockedCode === 'UNRESOLVED_TIE' ? prior.entryIds ?? [] : analysis.qualifiers }
        : node.module === 'elimination@1' ? { fixtures: analysis.bracket?.fixtures ?? [] }
        : node.module === 'placements@1' ? analysis.placements ?? {} : prior;
      const stageState = ['registration@1', 'entries@1'].includes(node.module) ? 'completed'
        : node.module === 'round_robin@1' ? rrDone ? 'completed' : 'ready'
        : node.module === 'standings@1' ? rrDone ? analysis.ties.length ? 'blocked' : 'completed' : 'waiting'
        : node.module === 'qualify@1' ? analysis.qualifiers.length ? 'completed' : analysis.blockedCode ? 'blocked' : 'waiting'
        : node.module === 'elimination@1' ? analysis.bracket?.state ?? (analysis.blockedCode ? 'blocked' : 'waiting')
        : analysis.placements?.state ?? (analysis.blockedCode ? 'blocked' : 'waiting');
      put('stages', { id: stage.id, state: stageState, input_revision: inputRevision, output_revision: nextRevision, output: payload, blocked_code: stageState === 'blocked' ? analysis.blockedCode ?? 'UNRESOLVED_TIE' : null });
    }
    if (rankingStage && rrStage) {
      const round = work.rounds.find(r => r.stage_id === rrStage.id && r.is_current !== false)!;
      analysis.standings.forEach((row, i) => {
        const tie = analysis.ties.find(g => g.includes(row.entryId));
        const rank = tie ? analysis.standings.findIndex(r => tie.includes(r.entryId)) + 1 : i + 1;
        const existing = work.standings.find(s => s.stage_id === rankingStage.id && s.team_id === row.entryId);
        put('standings', { id: existing?.id ?? context.id(), stage_id: rankingStage.id, round_id: round.id, team_id: row.entryId, wins: row.wins, losses: row.losses, points_for: row.pointsFor, points_against: row.pointsAgainst, rank, input_revision: inputRevision, eligible: runtimeOptions.eligibleEntryIds!.includes(row.entryId), tie_group: tie ? tie.join(',') : null });
      });
      for (const row of work.standings.filter(s => s.stage_id === rankingStage.id && !analysis.standings.some(r => r.entryId === s.team_id))) put('standings', { id: row.id, wins: 0, losses: 0, points_for: 0, points_against: 0, rank: null, eligible: false, tie_group: null, input_revision: inputRevision });
    }
    if (analysis.state === 'completed') event({ modular_state: 'completed', completed_at: iso, result_version: Number(work.event!.result_version ?? 0) + 1, results_under_review: false });
    else if (analysis.bracket) event({ status: 'finals' });
    result = { ...result, runtime_state: analysis.state, ...(analysis.blockedCode ? { blocked_code: analysis.blockedCode } : {}) };
  }

  if (command === 'reviseTournament') return planRevision(snapshot, actor, data, context);
  if (command === 'updateEventDetails') return planEventDetails(snapshot, actor, data);
  if (command === 'createDraft' || command === 'updateDraft') {
    if (command === 'updateDraft') { needAdmin(); if (work.event?.modular_state !== 'draft') fail('PUBLISHED_DEFINITION', 'Published rules are immutable.'); }
    else if (work.event) fail('INVALID_STATE', 'Event already exists.');
    if (!Object.hasOwn(data, 'definition')) fail('INVALID_REQUEST', 'Definition is required.');
    const validation = validateDraft(data.definition);
    if (validation.errors.length) fail('INVALID_DEFINITION', 'Draft contains unsupported fields or rules.', validation);
    const definitionId = currentDefinition()?.id ?? context.id();
    effects.definition = { id: definitionId, schema_version: record(data.definition).schema_version === '2.0' ? 2 : 1, definition: structuredClone(data.definition), status: 'draft', canonical_hash: null };
    const partialEvent = record(record(data.definition).event);
    event({ definition_id: definitionId, modular_state: 'draft', ...(typeof partialEvent.name === 'string' ? { name: partialEvent.name } : {}) });
    result = { definition_id: definitionId, validation };
  } else if (command === 'addAdministrator' || command === 'removeAdministrator') {
    needOwner(); text(data.reason, 'reason', 1000);
    const userId = reference(data.user_id, 'user_id').toLowerCase();
    if (command === 'removeAdministrator' && userId === work.event!.created_by) fail('FORBIDDEN', 'The tournament owner cannot be removed.');
    const existing = work.admins?.find(row => row.user_id === userId);
    if (command === 'addAdministrator' && (existing || userId === work.event!.created_by)) fail('INVALID_STATE', 'This account is already a tournament administrator.');
    if (command === 'removeAdministrator' && !existing) fail('INVALID_STATE', 'This account is not a tournament administrator.');
    const change = { action: command === 'addAdministrator' ? 'add' as const : 'remove' as const, id: existing?.id ?? context.id(), user_id: userId };
    effects.admin_change = change; result = { administrator_id: change.id, user_id: userId, action: change.action };
  } else if (['commitCorrection', 'withdrawEntry', 'changeCourt'].includes(command)) {
    const intervention = command === 'commitCorrection' ? planCorrection(snapshot, actor, data, context) : command === 'withdrawEntry' ? planWithdrawal(snapshot, actor, data, context) : planCourtChange(snapshot, actor, data);
    if (intervention.effects.event) event(intervention.effects.event);
    for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) for (const patch of intervention.effects[table] ?? []) put(table, patch);
    result = intervention.result;
    if (command !== 'changeCourt' && work.event?.modular_state === 'active') syncRuntime();
  } else if (command === 'cancelTournament') {
    if (!work.event) fail('NOT_FOUND', 'Event not found.');
    needOwner(); state('draft', 'registration_open', 'registration_closed', 'ready', 'active'); text(data.reason, 'reason', 1000);
    event({ modular_state: 'cancelled', cancelled_at: iso, results_under_review: false });
    for (const row of work.matches.filter(m => m.status === 'in_progress' && m.is_current !== false)) put('matches', { id: row.id, status: 'validated', outcome_kind: 'no_contest', winner_team_id: null, score_a: null, score_b: null, ended_at: iso, result_revision: nextRevision, revision: nextRevision });
  } else {
    if (!work.event) fail('NOT_FOUND', 'Event not found.');
    if (work.event!.modular_state === 'cancelled') fail('INVALID_STATE', 'Cancelled events cannot be changed.');
    let d = definition();
    if (command === 'publishTournament') {
      needOwner(); state('draft');
      const validation = validateDraft(currentDefinition()!.definition, { publication: true, registration: true, now });
      if (!validation.valid) fail(validation.missing_fields.length ? 'MISSING_FIELDS' : 'INVALID_DEFINITION', 'Resolve definition issues before publishing.', validation);
      if (data.reviewed_definition_hash !== definitionHash(d)) fail('STALE_PREVIEW', 'Review the exact current definition.');
      const acknowledged = strings(data.acknowledged_warning_codes, 'acknowledged_warning_codes').sort();
      const warnings = [...new Set(validation.warnings.map(w => w.code))].sort();
      if (JSON.stringify(acknowledged) !== JSON.stringify(warnings)) fail('STALE_PREVIEW', 'Acknowledge the current warnings exactly.');
      effects.definition = { id: currentDefinition()!.id, schema_version: d.schema_version === '2.0' ? 2 : 1, definition: d, status: 'published', canonical_hash: definitionHash(d), approved_at: iso };
      event({ definition_id: currentDefinition()!.id, name: d.event.name, modular_state: 'registration_open', court_count: d.event.courts, max_players: d.registration.max_entries * (d.registration.entry_type === 'singles' ? 1 : 2), type: d.registration.entry_type === 'singles' ? 'singles' : 'doubles', is_public: d.event.visibility === 'public', is_open: d.registration.mode === 'open', timezone: d.event.timezone, court_name: d.event.venue_name, tournament_date: d.event.starts_at.slice(0, 10), rules_text: JSON.stringify(d.policies) });
      for (const node of d.nodes) put('stages', { id: context.id(), definition_id: currentDefinition()!.id, node_id: node.id, module_id: node.module.split('@')[0], module_version: Number(node.module.split('@')[1]), state: 'waiting', input_revision: 0, output_revision: 0, output: {}, blocked_code: null });
    } else if (command === 'addRegisteredEntry') {
      needAdmin(); admissionWindow(d);
      if (data.definition_id !== currentDefinition()?.id) fail('STALE_PREVIEW', 'Review the current published definition before registering accounts.');
      text(data.reason, 'reason', 1000);
      const name = text(data.entry_name, 'entry_name', 120);
      const playerIds = strings(data.player_ids, 'player_ids').map(value => reference(value, 'player_ids').toLowerCase());
      if (playerIds.length !== (d.registration.entry_type === 'singles' ? 1 : 2) || new Set(playerIds).size !== playerIds.length) fail('INVALID_REQUEST', 'Choose the required number of distinct Picktennt profile IDs.');
      if (work.team_members.some(member => playerIds.includes(String(member.user_id).toLowerCase()) && ['active', 'pending'].includes(String(member.membership_status)) && work.teams.some(team => team.id === member.team_id && !['cancelled', 'withdrawn', 'rejected'].includes(String(team.entry_state))))) fail('DUPLICATE_ENTRY', 'A selected player already has a current entry or invitation.');
      if (work.teams.filter(team => team.entry_state === 'approved').length >= d.registration.max_entries) fail('CAPACITY_FULL', 'The tournament has no available entry slots.');
      const team = { id: context.id(), name, entry_state: 'approved', admin_definition_id: currentDefinition()!.id, registered_by: actor.id };
      put('teams', team);
      for (const userId of playerIds) {
        const member = { id: context.id(), team_id: team.id, user_id: userId, membership_status: 'active', admission_source: 'administrator', consented_at: null, consented_definition_id: null };
        put('team_members', member); projectMember(member, 'approved');
      }
      bumpRoster(); result = { entry_id: team.id, entry_state: 'approved' };
    } else if (command === 'addGuestEntry') {
      needAdmin(); admissionWindow(d);
      if (data.definition_id !== currentDefinition()?.id) fail('STALE_PREVIEW', 'Review the current published definition before registering guests.');
      text(data.reason, 'reason', 1000);
      const names = strings(data.player_names, 'player_names').map(name => text(name, 'player name', 120));
      if (names.length !== (d.registration.entry_type === 'singles' ? 1 : 2) || new Set(names.map(name=>name.toLowerCase())).size !== names.length) fail('INVALID_REQUEST', 'Provide one distinct name for each guest player in this entry.');
      if (work.teams.filter(t=>t.entry_state==='approved').length >= d.registration.max_entries) fail('CAPACITY_FULL', 'The tournament has no available entry slots.');
      const team = { id: context.id(), name: names.join(' / '), entry_state: 'approved', guest_definition_id: currentDefinition()!.id, guest_players: names.map(name=>({id:context.id(),name})) };
      put('teams',team); bumpRoster(); result={entry_id:team.id,entry_state:'approved'};
    } else if (['requestEntry', 'acceptPartner', 'approveEntry', 'rejectEntry', 'cancelEntry'].includes(command)) {
      if (command === 'requestEntry') {
        admissionWindow(d); consent(d);
        if (work.team_members.some(m => m.user_id === actor.id && (m.membership_status === 'active' || (m.membership_status === 'pending' && m.consented_at)))) fail('DUPLICATE_ENTRY', 'You already have a current entry.');
        const partner = d.registration.entry_type === 'fixed_doubles' ? reference(data.partner_id, 'partner_id') : undefined;
        if (partner === actor.id || (d.registration.entry_type === 'singles' && data.partner_id !== undefined)) fail('INVALID_REQUEST', 'Choose a distinct partner only for fixed doubles.');
        const team = { id: context.id(), name: data.entry_name === undefined ? 'Entry' : text(data.entry_name, 'entry_name'), entry_state: 'pending' };
        put('teams', team);
        const member = { id: context.id(), team_id: team.id, user_id: actor.id, consented_definition_id: currentDefinition()!.id, consented_at: iso, membership_status: 'pending' };
        put('team_members', member); projectMember(member, 'pending');
        if (partner) put('team_members', { id: context.id(), team_id: team.id, user_id: partner, consented_definition_id: null, consented_at: null, membership_status: 'pending' });
        const admitted = !partner && d.registration.mode === 'open' ? admit(team, d) : false;
        result = { entry_id: team.id, entry_state: partner ? 'awaiting_partner' : admitted ? 'approved' : 'pending_approval', ...(!partner && d.registration.mode === 'open' && !admitted ? { admission_error: 'CAPACITY_FULL' } : {}) };
      } else {
        const team = entry();
        if (command === 'acceptPartner') {
          admissionWindow(d); consent(d);
          const member = members(team.id).find(m => m.user_id === actor.id && (!m.consented_at || m.consented_definition_id !== currentDefinition()!.id));
          if (!member || team.entry_state !== 'pending') fail('FORBIDDEN', 'Only the actual invited partner may accept.');
          put('team_members', { id: member!.id, consented_definition_id: currentDefinition()!.id, consented_at: iso }); projectMember(member!, 'pending');
          const admitted = d.registration.mode === 'open' && complete(team, d) ? admit(team, d) : false;
          result = { entry_id: team.id, entry_state: admitted ? 'approved' : 'pending_approval', ...(d.registration.mode === 'open' && !admitted ? { admission_error: 'CAPACITY_FULL' } : {}) };
        } else if (command === 'approveEntry') {
          needAdmin(); admissionWindow(d); if (team.entry_state !== 'pending') fail('INVALID_STATE', 'Only pending entries can be approved.');
          const admitted = admit(team, d); result = { entry_id: team.id, entry_state: admitted ? 'approved' : 'pending_approval', ...(!admitted ? { admission_error: 'CAPACITY_FULL' } : {}) };
        } else {
          state('registration_open', 'registration_closed');
          if (command === 'rejectEntry') { needAdmin(); text(data.reason, 'reason', 1000); if (team.entry_state !== 'pending') fail('INVALID_STATE', 'Only pending entries can be rejected.'); }
          else if (!members(team.id).some(m => m.user_id === actor.id)) fail('FORBIDDEN', 'Only an entry participant can cancel it.');
          put('teams', { id: team.id, entry_state: command === 'cancelEntry' ? 'cancelled' : 'rejected' });
          for (const member of members(team.id)) { put('team_members', { id: member.id, membership_status: 'cancelled' }); if (member.consented_at || member.admission_source === 'administrator') projectMember(member, 'rejected'); }
          result = { entry_id: team.id, entry_state: command === 'cancelEntry' ? 'cancelled' : 'rejected' };
        }
      }
      bumpRoster();
    } else if (command === 'closeRegistration') { needAdmin(); state('registration_open'); event({ modular_state: 'registration_closed', registration_closed_at: iso });
    } else if (command === 'reopenRegistration') { needAdmin(); state('registration_closed'); if (Date.parse(d.registration.closes_at) <= now.getTime()) fail('REGISTRATION_CLOSED', 'Published registration deadline has passed.'); event({ modular_state: 'registration_open', registration_closed_at: null });
    } else if (command === 'lockRoster') {
      needAdmin(); state('registration_closed');
      if (data.preview_hash !== undefined && data.preview_hash !== previewSchedule(snapshot, actor, data, context.now).preview_hash) fail('STALE_PREVIEW', 'The roster or schedule changed. Review the schedule again.');
      if (integer(data.reviewed_roster_revision, 'reviewed_roster_revision') !== Number(work.event!.roster_revision)) fail('STALE_REVISION', 'Review the current roster.');
      const approved = work.teams.filter(t => t.entry_state === 'approved');
      if (approved.length < d.registration.min_entries || approved.length > d.registration.max_entries || approved.some(t => !complete(t, d))) fail('INCOMPLETE_ROSTER', 'The actual approved roster does not satisfy the published rules.');
      let seedAssignments: Record<string, string> | undefined;
      if (d.schema_version === '2.0') {
        d = finalizeGraph(d, data.nodes);
        seedAssignments = assignGroupSlots(d, approved.map(t => t.id), data.group_assignments);
        if (data.nodes !== undefined) {
          const prior = currentDefinition()!;
          for (const node of d.nodes) if (!work.stages.some(stage => stage.node_id === node.id)) put('stages', { id: context.id(), definition_id: prior.id, node_id: node.id, module_id: node.module.split('@')[0], module_version: Number(node.module.split('@')[1]), state: 'waiting', input_revision: 0, output_revision: 0, output: {}, blocked_code: null });
        }
      } else if (data.nodes !== undefined || data.group_assignments !== undefined) fail('INVALID_REQUEST', 'Group finalization requires a version 2 graph.');
      const direct = d.nodes.some(n => n.module === 'elimination@1') && !d.nodes.some(n => n.module === 'round_robin@1');
      if (direct && ![2, 4, 8, 16].includes(approved.length)) fail('INVALID_CAPACITY', 'Direct elimination needs 2, 4, 8 or 16 actual entries.');
      bumpRoster();
      const entryIds = approved.map(t => t.id), seedOrder = direct || d.schema_version === '2.0' ? (data.preview_hash !== undefined ? generationOrder(snapshot, entryIds) : draw(entryIds)) : entryIds;
      const stage = work.stages.find(s => s.node_id === d.nodes.find(n => n.module === 'entries@1')!.id)!;
      put('stages', { id: stage.id, state: 'completed', output: { entryIds: seedOrder, ...(data.nodes !== undefined ? { finalizedNodes: d.nodes } : {}), ...(seedAssignments ? { seedAssignments } : {}), ...(direct ? { directDraw: { rosterRevision: work.event!.roster_revision, entryIds: seedOrder } } : {}) } });
      seedOrder.forEach((teamId, i) => put('teams', { id: teamId, seed: seedAssignments ? Number(Object.keys(seedAssignments).find(key => seedAssignments![key] === teamId)) : i + 1 }));
      event({ modular_state: 'ready' }); syncRuntime();
      result.roster_hash = definitionHash(seedOrder.map(teamId => ({ id: teamId, players: entryPlayerIds(work, teamId) })));
    } else if (command === 'startTournament') { needAdmin(); state('ready'); event({ modular_state: 'active' });
    } else if (command === 'startMatch') {
      state('active'); const row = match();
      if (!admin && !ownEntry(row)) fail('FORBIDDEN', 'Only a participating player or admin may start.');
      let restOverrideReason: string | undefined;
      if (Object.hasOwn(data, 'rest_override_reason')) {
        needAdmin(); restOverrideReason = text(data.rest_override_reason, 'rest_override_reason', 500);
      }
      if (row.status !== 'scheduled' || !row.team_a_id || !row.team_b_id || ![row.team_a_id, row.team_b_id].every(teamId => work.teams.some(t => t.id === teamId && t.entry_state === 'approved'))) fail('INVALID_STATE', 'Match dependencies and participants must be eligible.');
      const live = work.matches.filter(m => m.id !== row.id && m.is_current !== false && !m.voided_at && m.status === 'in_progress');
      if (live.some(m => m.court_number === row.court_number)) fail('COURT_BUSY', 'The assigned court is occupied.');
      const players = [...entryPlayerIds(work, String(row.team_a_id)), ...entryPlayerIds(work, String(row.team_b_id))];
      const overlaps = (m: StorageRow) => [...entryPlayerIds(work, String(m.team_a_id)), ...entryPlayerIds(work, String(m.team_b_id))].some(id => players.includes(id));
      if (live.some(overlaps)) fail('PLAYER_BUSY', 'A player is already playing.');
      put('matches', { id: row.id, status: 'in_progress', started_at: iso, revision: nextRevision });
      if (restOverrideReason) result.rest_override_reason = restOverrideReason;
    } else if (['submitScore', 'confirmScore', 'attestScore', 'adjudicateDispute', 'disputeScore'].includes(command)) {
      state('active'); const row = match(), own = ownEntry(row);
      if (command === 'submitScore') {
        if (!own && !admin) fail('FORBIDDEN', 'Only a participant or admin may submit.');
        if (!['scheduled', 'in_progress'].includes(String(row.status))) fail('INVALID_STATE', 'Only an unscored match can receive a score.');
        if (!row.team_a_id || !row.team_b_id || ![row.team_a_id, row.team_b_id].every(teamId => work.teams.some(t => t.id === teamId && t.entry_state === 'approved'))) fail('INVALID_STATE', 'Match dependencies and participants must be eligible.');
        if (!isLegalScore(data.score_a as number, data.score_b as number, d.policies.match)) fail('INVALID_SCORE', 'Completed score violates the published game rules.');
        put('matches', { id: row.id, status: 'score_entered', outcome_kind: 'played', score_a: data.score_a, score_b: data.score_b, winner_team_id: Number(data.score_a) > Number(data.score_b) ? row.team_a_id : row.team_b_id, submitted_entry_id: own ?? null, entered_by: actor.id, ended_at: iso, result_revision: nextRevision, revision: nextRevision });
      } else if (command === 'confirmScore') {
        if (row.status !== 'score_entered') fail('INVALID_STATE', 'There is no provisional score to confirm.');
        if (integer(data.result_revision, 'result_revision') !== Number(row.result_revision)) fail('STALE_REVISION', 'Confirm the current submitted result.');
        if (!own || !row.submitted_entry_id || own === row.submitted_entry_id) fail('FORBIDDEN', 'Only the actual opposing entry may confirm; admins use reasoned attestation.');
        put('matches', { id: row.id, status: 'validated', validated_by: actor.id, result_revision: nextRevision, revision: nextRevision }); syncRuntime();
      } else if (command === 'disputeScore') {
        if (!own && !admin) fail('FORBIDDEN', 'Only a participant or admin may dispute.');
        if (row.status !== 'score_entered') fail('INVALID_STATE', 'Only a provisional result can be disputed.');
        if (integer(data.result_revision, 'result_revision') !== Number(row.result_revision)) fail('STALE_REVISION', 'Dispute the current result.');
        text(data.reason, 'reason', 1000); put('matches', { id: row.id, status: 'disputed', result_revision: nextRevision, revision: nextRevision });
      } else {
        needAdmin(); text(data.reason, 'reason', 1000);
        if (command === 'adjudicateDispute' && row.status !== 'disputed') fail('INVALID_STATE', 'Only a disputed result may be adjudicated.');
        if (!['scheduled', 'in_progress', 'score_entered', 'disputed'].includes(String(row.status))) fail('INVALID_STATE', 'Accepted results require the correction workflow.');
        const kind = data.outcome_kind ?? 'played';
        if (!['played', 'retirement', 'walkover', 'no_contest'].includes(String(kind))) fail('INVALID_REQUEST', 'Unsupported outcome kind.');
        if (kind === 'walkover' && (row.started_at || ['played', 'retirement'].includes(String(row.outcome_kind)))) fail('INVALID_STATE', 'A physically started match requires retirement rather than walkover.');
        if (['walkover', 'no_contest'].includes(String(kind)) && (data.score_a != null || data.score_b != null)) fail('INVALID_SCORE', 'Administrative empty outcomes cannot invent points.');
        if (kind === 'retirement') for (const value of [data.score_a, data.score_b]) if (value != null && (!Number.isSafeInteger(value) || Number(value) < 0)) fail('INVALID_SCORE', 'Partial retirement scores must be nonnegative integers.');
        let winner: unknown = data.winner_entry_id ?? null;
        if (kind === 'played') {
          if (!row.team_a_id || !row.team_b_id || ![row.team_a_id, row.team_b_id].every(teamId => work.teams.some(t => t.id === teamId && t.entry_state === 'approved'))) fail('INVALID_STATE', 'Match dependencies and participants must be eligible.');
          if (!isLegalScore(data.score_a as number, data.score_b as number, d.policies.match)) fail('INVALID_SCORE', 'Played scores require a legal final score.');
          winner = Number(data.score_a) > Number(data.score_b) ? row.team_a_id : row.team_b_id;
          if (data.winner_entry_id !== undefined && data.winner_entry_id !== winner) fail('INVALID_SCORE', 'Winner disagrees with the played score.');
        } else if (kind === 'no_contest') { if (winner !== null) fail('INVALID_SCORE', 'No-contest has no winner.'); }
        else if (!winner || ![row.team_a_id, row.team_b_id].includes(winner)) fail('INVALID_SCORE', 'Administrative outcome requires a participating winner.');
        if (winner && !work.teams.some(t => t.id === winner && t.entry_state === 'approved')) fail('INVALID_STATE', 'Winner is ineligible.');
        put('matches', { id: row.id, status: kind === 'walkover' ? 'walkover' : 'validated', outcome_kind: kind, winner_team_id: winner, score_a: ['played', 'retirement'].includes(String(kind)) ? data.score_a ?? null : null, score_b: ['played', 'retirement'].includes(String(kind)) ? data.score_b ?? null : null, validated_by: actor.id, ended_at: row.started_at || ['played', 'retirement'].includes(String(kind)) ? row.ended_at ?? iso : null, result_revision: nextRevision, revision: nextRevision }); syncRuntime();
      }
      result.match_id = row.id;
    } else if (command === 'resolveTie') {
      needAdmin(); state('active');
        const stageId = reference(data.stage_id, 'stage_id'), stage = work.stages.find(s => s.id === stageId && (s.module_id === 'standings' || (d.schema_version === '2.0' && ((s.module_id === 'round_robin' && s.module_version === 2) || (s.module_id === 'cross_play' && s.module_version === 1)))));
      if (!stage) fail('NOT_FOUND', 'Standings stage not found.');
      const output = record(stage!.output), inputRevision = integer(data.input_revision, 'input_revision');
      if (inputRevision !== Number(output.inputRevision)) fail('STALE_REVISION', 'Ranking inputs changed.');
      const ids = strings(data.entry_ids, 'entry_ids');
      const ties = output.ties as string[][];
      if (!Array.isArray(ties) || !ties.some(group => group.length === ids.length && group.every(id => ids.includes(id)))) fail('UNRESOLVED_TIE', 'Select an entire current tied group.');
      const permutation = draw(ids);
      put('stages', { id: stage!.id, output: { ...output, rankingDraws: [...(output.rankingDraws as unknown[] ?? []), { inputRevision, entryIds: permutation }] } });
      syncRuntime(); result.draw = permutation;
    } else if (command === 'reopenResults') {
      needOwner(); state('completed'); text(data.reason, 'reason', 1000); event({ modular_state: 'active', results_under_review: true, completed_at: null });
      const stage = work.stages.find(s => s.module_id === 'placements'); if (stage) put('stages', { id: stage.id, state: 'blocked', blocked_code: 'RESULTS_UNDER_REVIEW' });
    }
  }
  if (effects.matches) {
    const patches = effects.matches, ordered: StorageRow[] = [], visited = new Set<string>();
    function visit(patch: StorageRow) {
      if (visited.has(patch.id)) return;
      visited.add(patch.id);
      for (const key of ['bracket_next_winner_match_id', 'bracket_next_loser_match_id']) {
        const target = patches.find(row => row.id === patch[key]); if (target) visit(target);
      }
      ordered.push(patch);
    }
    // Free current logical keys before replacements, then satisfy immediate successor FKs.
    patches.filter(patch => patch.is_current === false).forEach(visit);
    patches.forEach(visit);
    effects.matches = ordered;
  }
  return { effects, result };
}
import type { TournamentDefinition } from './definition';
import { validateDraft } from './validate';
import { definitionHash, DomainError, UUID } from './requests';
import { isLegalScore, type OutcomeKind } from './policies';
import { analyzeTournament } from './runtime';
import type { FixtureResult, RuntimeOptions, TournamentEntry } from './types';
import { planCorrection, planCourtChange, planWithdrawal } from './corrections';
