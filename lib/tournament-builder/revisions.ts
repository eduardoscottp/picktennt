import type { CommandActor, CommandContext, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { definitionHash, DomainError, UUID } from './requests';
import { validateDraft } from './validate';
import { entryPlayerIds } from './entry-roster';
import { resolvedDefinition } from './resolved-definition';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const text = (value: unknown, label: string, max = 1000): string => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail('INVALID_REQUEST', `Provide ${label} (up to ${max} characters).`);
function admin(s: CommandSnapshot, actor: CommandActor) {
  if (!s.event) fail('NOT_FOUND', 'Tournament not found.');
  if (s.event!.created_by !== actor.id && actor.role !== 'admin') fail('FORBIDDEN', 'Tournament administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) fail('FORBIDDEN', 'Explicit administrator permission required.');
}
export function structuralEditingLocked(s: CommandSnapshot): boolean {
  return s.matches.some(m => Boolean(m.started_at) || m.status !== 'scheduled' || Boolean(m.outcome_kind) || m.score_a != null || m.score_b != null);
}
export interface RevisedEntry { entry_id: string; entry_name: string; player_ids: string[]; remove?: boolean }

/** Review is read-only and binds the entire proposed change to the event revision. */
export function previewRevision(s: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  admin(s, actor);
  if (!['registration_open', 'registration_closed', 'ready', 'active'].includes(String(s.event!.modular_state))) fail('INVALID_STATE', 'Revise a published tournament before play begins.');
  if (structuralEditingLocked(s)) fail('STRUCTURE_LOCKED', 'A match has started or an outcome was recorded. Use result impact review; teams and groups are locked.');
  if (Object.keys(data).some(k => !['definition', 'entries', 'reason', 'preview_hash'].includes(k))) fail('INVALID_REQUEST', 'Unexpected revision field.');
  const reason = text(data.reason, 'a reason');
  const validation = validateDraft(data.definition, { registration: true });
  if (!validation.valid || !validation.definition) fail('INVALID_DEFINITION', [...validation.errors, ...validation.missing_fields].map(i => i.message).join(' ') || 'Complete the revised definition.');
  const definition = validation.definition!;
  if (data.entries !== undefined && !Array.isArray(data.entries)) fail('INVALID_REQUEST', 'Provide an entry-edit array.');
  const entries: RevisedEntry[] = [], seen = new Set<string>();
  for (const value of (data.entries ?? []) as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST', 'Invalid entry edit.');
    const e = value as Record<string, unknown>;
    if (Object.keys(e).some(k => !['entry_id', 'entry_name', 'player_ids', 'remove'].includes(k))) fail('INVALID_REQUEST', 'Unexpected entry field.');
    if (typeof e.entry_id !== 'string' || !UUID.test(e.entry_id) || seen.has(e.entry_id)) fail('INVALID_REQUEST', 'Choose each existing entry only once.');
    const id = e.entry_id as string;
    seen.add(id);
    const team = s.teams.find(t => t.id === id && ['approved', 'pending'].includes(String(t.entry_state)));
    if (!team) fail('NOT_FOUND', 'Choose a current entry.');
    if (e.remove !== undefined && typeof e.remove !== 'boolean') fail('INVALID_REQUEST', 'Removal must be true or false.');
    if (e.remove === true) { entries.push({ entry_id: id, entry_name: String(team!.name), player_ids: [], remove: true }); continue; }
    if (team!.entry_state !== 'approved') fail('INVALID_STATE', 'Approve a pending entry before changing its players.');
    if (!Array.isArray(e.player_ids) || !e.player_ids.every(p => typeof p === 'string' && UUID.test(p))) fail('INVALID_REQUEST', 'Choose existing Picktennt player profiles.');
    entries.push({ entry_id: id, entry_name: text(e.entry_name, 'a team name', 120), player_ids: (e.player_ids as string[]).map(p => p.toLowerCase()) });
  }
  const retained = s.teams.filter(t => ['approved', 'pending'].includes(String(t.entry_state)) && !entries.some(e => e.entry_id === t.id && e.remove));
  if (retained.length > definition.registration.max_entries) fail('CAPACITY_FULL', 'Capacity is below the retained approved and pending entries. Explicitly remove excess entries first.');
  const approved = retained.filter(t => t.entry_state === 'approved').map(t => entries.find(e => e.entry_id === t.id) ?? { entry_id: t.id, entry_name: String(t.name), player_ids: entryPlayerIds(s, t.id) });
  const players = new Set<string>();
  const required = definition.registration.entry_type === 'singles' ? 1 : 2;
  const beforeFixtures = s.matches.length === 0;
  for (const e of approved) {
    if (e.player_ids.length !== required && !(beforeFixtures && required === 2 && e.player_ids.length === 1)) fail('INCOMPLETE_ROSTER', `Each retained team must have ${required} registered player(s).`);
    for (const id of e.player_ids) {
      if (!UUID.test(id)) fail('ACCOUNT_REQUIRED', 'All players must have Picktennt accounts.');
      if (beforeFixtures && !s.tournament_players.some(p => p.user_id === id && p.status === 'approved')) fail('NOT_REGISTERED', 'Only players who already joined can be placed in the revised roster.');
      if (players.has(id)) fail('DUPLICATE_ENTRY', 'A player cannot belong to two retained teams. Submit both sides of a swap together.');
      players.add(id);
    }
  }
  const unplaced = s.tournament_players.filter(p => p.status === 'approved' && !players.has(String(p.user_id)) && !s.team_members.some(m => m.user_id === p.user_id && ['active', 'pending'].includes(String(m.membership_status))));
  if (beforeFixtures && players.size + unplaced.length > definition.registration.max_entries * required) fail('CAPACITY_FULL', 'Capacity is below the retained joined players.');
  const pending = retained.filter(t => t.entry_state === 'pending');
  if (pending.length && (resolvedDefinition(s)?.definition as { registration?: { entry_type?: string } })?.registration?.entry_type !== definition.registration.entry_type) fail('INCOMPLETE_ROSTER', 'Resolve pending invitations before changing singles/doubles.');
  for (const m of s.team_members.filter(m => pending.some(t => t.id === m.team_id) && ['pending', 'active'].includes(String(m.membership_status)))) {
    if (players.has(String(m.user_id).toLowerCase())) fail('DUPLICATE_ENTRY', 'A selected player has a retained pending invitation. Remove that entry first.');
  }
  const affected_match_ids = s.matches.filter(m => m.is_current !== false).map(m => m.id).sort();
  const warnings = validation.warnings.map(w => w.message);
  if (beforeFixtures) warnings.push('Joined players are retained; teams use individual positions. Incomplete teams must be filled before generating fixtures.');
  if (pending.length) warnings.push('Pending entrants must accept the current rules before approval.');
  if (approved.length < definition.registration.min_entries) warnings.push('More approved entries are required before generating matches.');
  const payload = { event_revision: Number(s.event!.revision), definition, entries, reason, affected_match_ids,
    affected_nodes: [...new Set(s.stages.map(stage => String(stage.node_id)))].sort(), approved_entries: approved,
    warnings, next_state: 'registration_closed' as const };
  return { ...payload, preview_hash: definitionHash({ tournament_id: s.event!.id, ...payload }) };
}

export function planRevision(s: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, context: CommandContext): CommandPlan {
  const preview = previewRevision(s, actor, data);
  if (data.preview_hash !== preview.preview_hash) fail('STALE_PREVIEW', 'Review the current revision impact before confirming.');
  const d = preview.definition, id = context.id();
  const teams: StorageRow[] = [], members: StorageRow[] = [], projections: StorageRow[] = [];
  const affectedTeams = new Set([...preview.approved_entries.map(e => e.entry_id), ...preview.entries.filter(e => e.remove).map(e => e.entry_id)]);
  // Cancel outgoing memberships before reusing or inserting the approved memberships.
  for (const m of s.team_members.filter(m => affectedTeams.has(String(m.team_id)) && ['active', 'pending'].includes(String(m.membership_status)))) members.push({ id: m.id, team_id: m.team_id, user_id: m.user_id, membership_status: 'cancelled' });
  for (const e of preview.entries.filter(e => e.remove)) teams.push({ id: e.entry_id, entry_state: 'cancelled', seed: null });
  const slots = new Set(s.teams.map(t => Number(t.registration_slot)).filter(slot => slot > 0));
  for (const e of preview.approved_entries) {
    const team = s.teams.find(t => t.id === e.entry_id)!;
    let slot = Number(team.registration_slot);
    if (s.matches.length === 0 && !slot) {
      slot = Array.from({ length: d.registration.max_entries }, (_, i) => i + 1).find(i => !slots.has(i)) ?? fail('CAPACITY_FULL', 'No visual team position is available.');
      slots.add(slot);
    }
    if (s.matches.length === 0 && slot > d.registration.max_entries) fail('CAPACITY_FULL', 'Move retained players inside the revised team capacity before revising.');
    teams.push({ id: e.entry_id, name: e.entry_name, seed: null, admin_definition_id: id, registered_by: actor.id, ...(s.matches.length === 0 ? { registration_slot: slot } : {}) });
    for (const user_id of e.player_ids) {
      const existing = s.team_members.find(m => m.team_id === e.entry_id && m.user_id === user_id);
      const patch = { id: existing?.id ?? context.id(), team_id: e.entry_id, user_id, membership_status: 'active', admission_source: 'administrator', consented_definition_id: existing?.consented_definition_id ?? null, consented_at: existing?.consented_at ?? null };
      const index = members.findIndex(m => m.id === patch.id);
      if (index >= 0) members[index] = patch; else members.push(patch);
    }
  }
  const approvedIds = new Set(preview.approved_entries.flatMap(e => e.player_ids));
  const affectedUsers = new Set([...s.team_members.filter(m => affectedTeams.has(String(m.team_id))).map(m => String(m.user_id)), ...approvedIds]);
  for (const user_id of affectedUsers) {
    const pending = s.team_members.some(m => m.user_id === user_id && !affectedTeams.has(String(m.team_id)) && ['pending', 'active'].includes(String(m.membership_status)));
    projections.push({ id: s.tournament_players.find(p => p.user_id === user_id)?.id ?? context.id(), user_id, status: approvedIds.has(user_id) ? 'approved' : pending ? 'pending' : 'rejected', joined_via: 'link' });
  }
  return { effects: {
    definition: { id, schema_version: d.schema_version === '2.0' ? 2 : 1, definition: d, status: 'published', canonical_hash: definitionHash(d), approved_at: context.now },
    event: { definition_id: id, name: d.event.name, modular_state: 'registration_closed', roster_revision: Number(s.event!.roster_revision) + 1, registration_closed_at: context.now,
      court_count: d.event.courts, max_players: d.registration.max_entries * (d.registration.entry_type === 'singles' ? 1 : 2), type: d.registration.entry_type === 'singles' ? 'singles' : 'doubles',
      is_public: d.event.visibility === 'public', is_open: d.registration.mode === 'open', timezone: d.event.timezone, court_name: d.event.venue_name, tournament_date: d.event.starts_at.slice(0, 10), rules_text: JSON.stringify(d.policies) },
    teams, team_members: members, tournament_players: projections,
    stages: d.nodes.map(n => ({ id: context.id(), definition_id: id, node_id: n.id, module_id: n.module.split('@')[0], module_version: Number(n.module.split('@')[1]), state: 'waiting', input_revision: 0, output_revision: 0, output: {}, blocked_code: null })),
    rounds: s.rounds.filter(r => r.is_current !== false).map(r => ({ id: r.id, is_current: false })),
    matches: s.matches.filter(m => m.is_current !== false).map(m => ({ id: m.id, is_current: false })),
  }, result: { definition_id: id, affected_match_ids: preview.affected_match_ids, next_state: preview.next_state } };
}

export function planEventDetails(s: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>): CommandPlan {
  admin(s, actor);
  if (['draft', 'cancelled'].includes(String(s.event!.modular_state))) fail('INVALID_STATE', 'Edit draft settings or an existing published tournament.');
  if (Object.keys(data).some(k => !['name', 'venue_name', 'reason'].includes(k))) fail('INVALID_REQUEST', 'Only the name and venue description can be corrected here.');
  text(data.reason, 'a reason');
  return { effects: { event: { name: text(data.name, 'the tournament name', 120), court_name: text(data.venue_name, 'the venue name', 200) } }, result: { details_updated: true } };
}
