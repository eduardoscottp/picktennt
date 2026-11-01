import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCommand, type CommandActor, type CommandContext, type CommandSnapshot, type CommandPlan, type StorageRow } from '../../lib/tournament-builder/commands';
import { previewCorrection } from '../../lib/tournament-builder/corrections';
import { definitionHash, requestHash } from '../../lib/tournament-builder/requests';

let counter = 100;
const id = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
const owner: CommandActor = { id: id(), clientId: 'web', role: 'owner' };
const admin: CommandActor = { id: id(), clientId: 'web', role: 'admin' };
const a: CommandActor = { id: id(), clientId: 'web', role: 'player' };
const b: CommandActor = { id: id(), clientId: 'web', role: 'player' };
const context: CommandContext = { now: '2026-10-28T16:00:00Z', id, draw: ids => [...ids].reverse() };
const empty = (): CommandSnapshot => ({ event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] });
const definition = () => {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  d.registration.entry_type = 'singles'; d.registration.partner_consent = false; d.registration.min_entries = 2; d.registration.max_entries = 2; d.registration.mode = 'open'; d.event.courts = 1; d.scheduling.minimum_rest_minutes = 5;
  d.nodes = [{ id: 'reg', module: 'registration@1' }, { id: 'roster', module: 'entries@1', from: 'reg' }, { id: 'rr', module: 'round_robin@1', from: 'roster' }, { id: 'rank', module: 'standings@1', from: 'rr' }, { id: 'result', module: 'placements@1', from: 'rank' }];
  return d;
};
function apply(snapshot: CommandSnapshot, plan: CommandPlan): CommandSnapshot {
  const next = structuredClone(snapshot);
  next.event = { id: next.event?.id ?? id(), created_by: next.event?.created_by ?? owner.id, modular_state: 'draft', revision: 0, roster_revision: 0, result_version: 0, ...next.event, ...plan.effects.event };
  next.event.revision = Number(next.event.revision) + 1;
  if (plan.effects.definition) {
    const old = next.definitions.findIndex(row => row.id === plan.effects.definition!.id);
    const row = { ...plan.effects.definition, revision: next.event.revision };
    if (old >= 0) next.definitions[old] = { ...next.definitions[old], ...row }; else next.definitions.push(row);
  }
  for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) {
    for (const patch of plan.effects[table] ?? []) {
      const index = next[table].findIndex(row => row.id === patch.id);
      if (index >= 0) next[table][index] = { ...next[table][index], ...patch }; else next[table].push(patch);
    }
  }
  return next;
}
function published(d = definition()): CommandSnapshot {
  let s = apply(empty(), planCommand(empty(), owner, 'createDraft', { definition: d }, context));
  s = apply(s, planCommand(s, owner, 'publishTournament', { reviewed_definition_hash: definitionHash(d), acknowledged_warning_codes: [] }, context));
  return s;
}
function register(s: CommandSnapshot, actor: CommandActor, extra = {}): CommandSnapshot {
  return apply(s, planCommand(s, actor, 'requestEntry', { consent: true, definition_id: s.event!.definition_id, ...extra }, context));
}
function ready(): CommandSnapshot {
  let s = register(register(published(), a), b);
  s = apply(s, planCommand(s, admin, 'closeRegistration', {}, context));
  return apply(s, planCommand(s, admin, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision }, context));
}
test('drafts remain partial; publication binds exact definition review and owner website authority', () => {
  const draft = apply(empty(), planCommand(empty(), owner, 'createDraft', { definition: { event: { name: 'Incomplete' } } }, context));
  assert.equal(draft.event!.modular_state, 'draft');
  assert.throws(() => planCommand(draft, owner, 'publishTournament', { reviewed_definition_hash: 'bad', acknowledged_warning_codes: [] }, context));
  const s = apply(empty(), planCommand(empty(), owner, 'createDraft', { definition: definition() }, context));
  const data = { reviewed_definition_hash: definitionHash(definition()), acknowledged_warning_codes: [] };
  assert.throws(() => planCommand(s, admin, 'publishTournament', data, context), { code: 'FORBIDDEN' });
  assert.throws(() => planCommand(s, { ...owner, clientId: 'connector' }, 'publishTournament', data, context), { code: 'FORBIDDEN' });
  assert.throws(() => planCommand(s, owner, 'publishTournament', { ...data, reviewed_definition_hash: 'bad' }, context), { code: 'STALE_PREVIEW' });
  assert.throws(() => planCommand(s, owner, 'closeRegistration', { injected: true }, context));
  const p = apply(s, planCommand(s, owner, 'publishTournament', data, context));
  assert.equal(p.tournament_players.length, 0, 'Organizing never enrolls owner.');
  assert.throws(() => planCommand(p, owner, 'updateDraft', { definition: definition() }, context), { code: 'PUBLISHED_DEFINITION' });
});
test('singles consent, slot capacity, duplicate membership and registration deadline are explicit', () => {
  const s = published();
  assert.throws(() => planCommand(s, a, 'requestEntry', { consent: false, definition_id: s.event!.definition_id }, context));
  const two = register(register(s, a), b);
  assert.equal(two.teams.filter(row => row.entry_state === 'approved').length, 2);
  assert.throws(() => planCommand(two, a, 'requestEntry', { consent: true, definition_id: s.event!.definition_id }, context), { code: 'DUPLICATE_ENTRY' });
  const c: CommandActor = { id: id(), clientId: 'web' };
  const full = planCommand(two, c, 'requestEntry', { consent: true, definition_id: s.event!.definition_id }, context);
  assert.equal(full.result.admission_error, 'CAPACITY_FULL');
  assert.equal(full.effects.teams?.[0].entry_state, 'pending');
  assert.throws(() => planCommand(s, a, 'requestEntry', { consent: true, definition_id: s.event!.definition_id }, { ...context, now: '2026-11-07T12:00:00Z' }), { code: 'REGISTRATION_CLOSED' });
});
test('fixed doubles requires both actual consents before approval and consumes only one entry slot', () => {
  const d = definition(); d.registration.entry_type = 'fixed_doubles'; d.registration.partner_consent = true; d.registration.mode = 'approval';
  let s = published(d);
  const requested = planCommand(s, a, 'requestEntry', { consent: true, definition_id: s.event!.definition_id, partner_id: b.id }, context);
  s = apply(s, requested);
  const entryId = s.teams[0].id;
  assert.equal(requested.result.entry_state, 'awaiting_partner');
  assert.throws(() => planCommand(s, admin, 'approveEntry', { entry_id: entryId }, context), { code: 'INCOMPLETE_ROSTER' });
  assert.throws(() => planCommand(s, a, 'acceptPartner', { entry_id: entryId, consent: true, definition_id: s.event!.definition_id }, context), { code: 'FORBIDDEN' });
  s = apply(s, planCommand(s, b, 'acceptPartner', { entry_id: entryId, consent: true, definition_id: s.event!.definition_id }, context));
  s = apply(s, planCommand(s, admin, 'approveEntry', { entry_id: entryId }, context));
  assert.equal(s.teams[0].entry_state, 'approved');
  assert.equal(s.team_members.filter(row => row.membership_status === 'active').length, 2);
});
test('individual slots require join first, move one player atomically, and allow withdrawal', () => {
  const d = definition(); d.registration.entry_type = 'fixed_doubles'; d.registration.partner_consent = false; d.registration.max_entries = 2;
  let s = published(d);
  assert.throws(() => planCommand(s, a, 'selectEntrySlot', { slot_index: 1 }, context), { code: 'NOT_REGISTERED' });
  s = apply(s, planCommand(s, a, 'joinTournament', { definition_id: s.event!.definition_id, consent: true }, context));
  s = apply(s, planCommand(s, a, 'selectEntrySlot', { slot_index: 1 }, context));
  const firstMembership = s.team_members.find(row => row.user_id === a.id && row.membership_status === 'active')!;
  assert.equal(s.teams.find(row => row.id === firstMembership.team_id)?.registration_slot, 1);
  s = apply(s, planCommand(s, a, 'selectEntrySlot', { slot_index: 2 }, context));
  assert.equal(s.team_members.filter(row => row.user_id === a.id && row.membership_status === 'active').length, 1);
  assert.equal(s.team_members.find(row => row.user_id === a.id && row.membership_status === 'active')?.team_id, s.teams.find(row => row.registration_slot === 2)?.id);
  assert.equal(s.team_members.find(row => row.id === firstMembership.id)?.membership_status, 'cancelled');
  s = apply(s, planCommand(s, b, 'joinTournament', { definition_id: s.event!.definition_id, consent: true }, context));
  s = apply(s, planCommand(s, b, 'selectEntrySlot', { slot_index: 2 }, context));
  assert.equal(s.team_members.filter(row => row.team_id === s.teams.find(team => team.registration_slot === 2)?.id && row.membership_status === 'active').length, 2);
  s = apply(s, planCommand(s, b, 'cancelRegistration', {}, context));
  assert.equal(s.tournament_players.find(row => row.user_id === b.id)?.status, 'rejected');
  assert.equal(s.team_members.find(row => row.user_id === b.id && row.membership_status === 'active'), undefined);
  assert.throws(() => planCommand(s, b, 'selectEntrySlot', { slot_index: 1 }, context), { code: 'NOT_REGISTERED' });
});
test('administrators can place only players who already joined an individual-slot tournament', () => {
  const d = definition(); d.registration.entry_type = 'fixed_doubles'; d.registration.partner_consent = false;
  let s = published(d);
  assert.throws(() => planCommand(s, admin, 'placeRegisteredPlayer', { user_id: a.id, slot_index: 1 }, context), { code: 'NOT_REGISTERED' });
  s = apply(s, planCommand(s, a, 'joinTournament', { definition_id: s.event!.definition_id, consent: true }, context));
  s = apply(s, planCommand(s, admin, 'placeRegisteredPlayer', { user_id: a.id, slot_index: 1 }, context));
  assert.equal(s.team_members.filter(row => row.user_id === a.id && row.membership_status === 'active').length, 1);
});
test('roster locks create deterministic local fixtures once and event starts explicitly', () => {
  const s = ready();
  assert.equal(s.event!.modular_state, 'ready');
  assert.equal(s.matches.length, 1); assert.equal(s.matches[0].court_number, 1);
  assert.throws(() => planCommand(s, a, 'startTournament', {}, context), { code: 'FORBIDDEN' });
  const active = apply(s, planCommand(s, admin, 'startTournament', {}, context));
  assert.equal(active.event!.modular_state, 'active');
  assert.throws(() => planCommand(active, admin, 'lockRoster', { reviewed_roster_revision: 0 }, context), { code: 'INVALID_STATE' });
});
test('confirmation follows actual submitting entry, rejects own side, and final acceptance completes event', () => {
  let s = ready(); s = apply(s, planCommand(s, owner, 'startTournament', {}, context));
  const matchId = s.matches[0].id;
  assert.throws(() => planCommand(s, b, 'submitScore', { match_id: matchId, score_a: 12, score_b: 8 }, context), { code: 'INVALID_SCORE' });
  const idBefore = s.matches[0].id;
  s = apply(s, planCommand(s, b, 'submitScore', { match_id: matchId, score_a: 11, score_b: 5 }, context));
  const data = { match_id: matchId, result_revision: s.matches[0].result_revision };
  assert.equal(s.event!.modular_state, 'active');
  assert.throws(() => planCommand(s, b, 'confirmScore', data, context), { code: 'FORBIDDEN' });
  s = apply(s, planCommand(s, a, 'confirmScore', data, context));
  assert.equal(s.matches[0].id, idBefore); assert.equal(s.matches.length, 1);
  assert.equal(s.event!.modular_state, 'completed');
  assert.equal(s.event!.result_version, 1);
  const stage = s.stages.find(row => row.node_id === 'result')!;
  assert.equal((stage.output as StorageRow).championEntryId, s.matches[0].winner_team_id);
});
test('court/player occupancy governs starts; elapsed rest never blocks the next game', () => {
  let s = ready(); s = apply(s, planCommand(s, owner, 'startTournament', {}, context));
  const match = s.matches[0], other = { ...match, id: id(), status: 'in_progress' };
  assert.throws(() => planCommand({ ...s, matches: [...s.matches, other] }, admin, 'startMatch', { match_id: match.id }, context), { code: 'COURT_BUSY' });
  const ended = { ...other, status: 'validated', ended_at: context.now, outcome_kind: 'played' };
  assert.doesNotThrow(() => planCommand({ ...s, matches: [...s.matches, ended] }, admin, 'startMatch', { match_id: match.id }, context));
  assert.doesNotThrow(() => planCommand({ ...s, matches: [...s.matches, { ...ended, outcome_kind: 'walkover' }] }, admin, 'startMatch', { match_id: match.id }, context));
});

test('rest override requires current administrator permission and an explicit reason without rewriting history', () => {
  let s = ready(); s = apply(s, planCommand(s, owner, 'startTournament', {}, context));
  const match = s.matches[0];
  const ended = { ...match, id: id(), is_current: false, status: 'validated', started_at: '2026-10-28T15:59:00Z', ended_at: context.now, outcome_kind: 'played' };
  s.matches.push(ended);
  const before = JSON.stringify(s);
  const data = { match_id: match.id, rest_override_reason: 'Synthetic tournament demonstration requested by owner.' };
  assert.throws(() => planCommand(s, a, 'startMatch', data, context), { code: 'FORBIDDEN' });
  assert.throws(() => planCommand({ ...s, matches: [match] }, a, 'startMatch', data, context), { code: 'FORBIDDEN' });
  assert.doesNotThrow(() => planCommand(s, admin, 'startMatch', { match_id: match.id }, context));
  for (const reason of ['', '  ', null, 42, 'x'.repeat(501)]) assert.throws(() => planCommand(s, admin, 'startMatch', { ...data, rest_override_reason: reason }, context), { code: 'INVALID_REQUEST' });
  for (const actor of [owner, admin]) {
    const plan = planCommand(s, actor, 'startMatch', data, context);
    assert.equal(plan.effects.matches!.length, 1);
    assert.equal(plan.effects.matches![0].id, match.id);
    assert.equal(plan.effects.matches![0].started_at, new Date(context.now).toISOString());
    assert.equal(plan.effects.matches![0].status, 'in_progress');
    assert.equal(plan.effects.definition, undefined);
    assert.equal(plan.result.rest_override_reason, data.rest_override_reason);
  }
  assert.equal(planCommand(s, admin, 'startMatch', { ...data, rest_override_reason: '  Owner requested test  ' }, context).result.rest_override_reason, 'Owner requested test');
  assert.doesNotThrow(() => planCommand(s, admin, 'startMatch', { ...data, rest_override_reason: 'x'.repeat(500) }, context));
  assert.notEqual(requestHash('startMatch', s.event!.id, Number(s.event!.revision), data), requestHash('startMatch', s.event!.id, Number(s.event!.revision), { match_id: match.id }));
  assert.notEqual(requestHash('startMatch', s.event!.id, Number(s.event!.revision), data), requestHash('startMatch', s.event!.id, Number(s.event!.revision), { ...data, rest_override_reason: 'Different reason' }));
  assert.equal(JSON.stringify(s), before);
});

test('administrator rest override never bypasses court or player occupancy', () => {
  let s = ready(); s = apply(s, planCommand(s, owner, 'startTournament', {}, context));
  s.event!.court_count = 2;
  s.definitions[0].definition = { ...definition(), event: { ...definition().event, courts: 2 } };
  const match = s.matches[0], other = { ...match, id: id(), status: 'in_progress' };
  const data = { match_id: match.id, rest_override_reason: 'Synthetic demonstration' };
  assert.throws(() => planCommand({ ...s, matches: [...s.matches, other] }, admin, 'startMatch', data, context), { code: 'COURT_BUSY' });
  assert.throws(() => planCommand({ ...s, matches: [...s.matches, { ...other, court_number: 2 }] }, admin, 'startMatch', data, context), { code: 'PLAYER_BUSY' });
});
test('dispute blocks completion, reasoned adjudication accepts, and only owner reopens results', () => {
  let s = ready(); s = apply(s, planCommand(s, admin, 'startTournament', {}, context));
  const matchId = s.matches[0].id;
  s = apply(s, planCommand(s, admin, 'startMatch', { match_id: matchId }, context));
  s = apply(s, planCommand(s, a, 'submitScore', { match_id: matchId, score_a: 11, score_b: 9 }, context));
  s = apply(s, planCommand(s, b, 'disputeScore', { match_id: matchId, result_revision: s.matches[0].result_revision, reason: 'Reported score differs.' }, context));
  assert.equal(s.event!.modular_state, 'active'); assert.equal(s.matches[0].status, 'disputed');
  assert.throws(() => planCommand(s, admin, 'adjudicateDispute', { match_id: matchId, score_a: 11, score_b: 9, reason: '' }, context));
  s = apply(s, planCommand(s, admin, 'adjudicateDispute', { match_id: matchId, score_a: 11, score_b: 9, reason: 'Both players confirmed on review.' }, context));
  assert.equal(s.event!.modular_state, 'completed');
  assert.throws(() => planCommand(s, admin, 'reopenResults', { reason: 'Review' }, context), { code: 'FORBIDDEN' });
  s = apply(s, planCommand(s, owner, 'reopenResults', { reason: 'Review' }, context));
  assert.equal(s.event!.results_under_review, true); assert.equal(s.event!.modular_state, 'active');
});
test('owner can cancel incomplete drafts and active matches without fabricating a winner', () => {
  const draft = apply(empty(), planCommand(empty(), owner, 'createDraft', { definition: {} }, context));
  assert.equal(planCommand(draft, owner, 'cancelTournament', { reason: 'Event no longer happening.' }, context).effects.event?.modular_state, 'cancelled');
  let s = ready(); s = apply(s, planCommand(s, owner, 'startTournament', {}, context));
  s = apply(s, planCommand(s, a, 'startMatch', { match_id: s.matches[0].id }, context));
  assert.throws(() => planCommand(s, admin, 'cancelTournament', { reason: 'Cancel' }, context), { code: 'FORBIDDEN' });
  const cancelled = apply(s, planCommand(s, owner, 'cancelTournament', { reason: 'Venue closed.' }, context));
  assert.equal(cancelled.event!.modular_state, 'cancelled'); assert.equal(cancelled.matches[0].winner_team_id, null);
  assert.equal(cancelled.matches[0].outcome_kind, 'no_contest');
});
test('F01 full command workflow preserves all UUIDs while materializing only newly eligible playoffs', () => {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  let s = published(d);
  const players: CommandActor[][] = [];
  for (let i = 0; i < 8; i++) {
    const pair = [{ id: id(), clientId: 'web' }, { id: id(), clientId: 'web' }]; players.push(pair);
    s = register(s, pair[0], { partner_id: pair[1].id, entry_name: String.fromCharCode(65 + i) });
    const team = s.teams.at(-1)!;
    s = apply(s, planCommand(s, pair[1], 'acceptPartner', { entry_id: team.id, consent: true, definition_id: s.event!.definition_id }, context));
    s = apply(s, planCommand(s, admin, 'approveEntry', { entry_id: team.id }, context));
  }
  s = apply(s, planCommand(s, admin, 'closeRegistration', {}, context));
  s = apply(s, planCommand(s, admin, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision }, context));
  assert.equal(s.matches.length, 28);
  const originalIds = s.matches.map(m => m.id);
  s = apply(s, planCommand(s, admin, 'startTournament', {}, context));
  let clock = Date.parse(context.now);
  while (s.event!.modular_state !== 'completed') {
    const current = s.matches.find(m => m.status === 'scheduled' && m.team_a_id && m.team_b_id);
    assert.ok(current, 'There must be an eligible fixture until complete.');
    const matchContext = { ...context, now: new Date(clock += 30 * 60_000).toISOString() };
    const teamA = s.teams.find(t => t.id === current.team_a_id)!, teamB = s.teams.find(t => t.id === current.team_b_id)!;
    const actorA = players[String(teamA.name).charCodeAt(0) - 65][0], actorB = players[String(teamB.name).charCodeAt(0) - 65][0];
    s = apply(s, planCommand(s, admin, 'startMatch', { match_id: current.id }, matchContext));
    const aWins = String(teamA.name) < String(teamB.name);
    s = apply(s, planCommand(s, actorA, 'submitScore', { match_id: current.id, score_a: aWins ? 11 : 5, score_b: aWins ? 5 : 11 }, matchContext));
    s = apply(s, planCommand(s, actorB, 'confirmScore', { match_id: current.id, result_revision: s.matches.find(m => m.id === current.id)!.result_revision }, matchContext));
  }
  assert.equal(s.matches.length, 31); assert.equal(s.event!.result_version, 1);
  assert.ok(originalIds.every(original => s.matches.some(m => m.id === original)));
  const placements = s.stages.find(stage => stage.module_id === 'placements')!.output as { groups: { rank: number; entryIds: string[] }[] };
  assert.deepEqual(placements.groups.map(g => [g.rank, g.entryIds.length]), [[1, 1], [2, 1], [3, 2], [5, 1], [6, 1], [7, 1], [8, 1]]);
});
test('current whole-group draw unblocks tied qualification and remains stable during playoffs', () => {
  const d = definition(); d.registration.min_entries = 3; d.registration.max_entries = 3;
  d.nodes = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')).nodes;
  d.nodes.find((node: ReturnType<typeof definition>) => node.module === 'qualify@1').config.count = 2;
  let s = published(d);
  const players = [a, b, { id: id(), clientId: 'web' }];
  for (let i = 0; i < players.length; i++) s = register(s, players[i], { entry_name: String.fromCharCode(65 + i) });
  s = apply(s, planCommand(s, admin, 'closeRegistration', {}, context));
  s = apply(s, planCommand(s, admin, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision }, context));
  s = apply(s, planCommand(s, admin, 'startTournament', {}, context));
  let clock = Date.parse(context.now);
  for (const initial of [...s.matches]) {
    const ctx = { ...context, now: new Date(clock += 30 * 60_000).toISOString() };
    const teamA = s.teams.find(team => team.id === initial.team_a_id)!, teamB = s.teams.find(team => team.id === initial.team_b_id)!;
    const pair = [String(teamA.name), String(teamB.name)].sort().join(''), winner = pair === 'AC' ? 'C' : pair[0];
    const actorA = players[String(teamA.name).charCodeAt(0) - 65], actorB = players[String(teamB.name).charCodeAt(0) - 65];
    s = apply(s, planCommand(s, admin, 'startMatch', { match_id: initial.id }, ctx));
    s = apply(s, planCommand(s, actorA, 'submitScore', { match_id: initial.id, score_a: teamA.name === winner ? 11 : 9, score_b: teamB.name === winner ? 11 : 9 }, ctx));
    s = apply(s, planCommand(s, actorB, 'confirmScore', { match_id: initial.id, result_revision: s.matches.find(m => m.id === initial.id)!.result_revision }, ctx));
  }
  assert.equal(s.matches.length, 3);
  const stage = s.stages.find(row => row.module_id === 'standings')!, output = stage.output as { inputRevision: number; ties: string[][] };
  const data = { stage_id: stage.id, input_revision: output.inputRevision, entry_ids: output.ties[0] };
  assert.throws(() => planCommand(s, admin, 'resolveTie', { ...data, entry_ids: data.entry_ids.slice(0, 2) }, context), { code: 'UNRESOLVED_TIE' });
  assert.throws(() => planCommand(s, admin, 'resolveTie', { ...data, input_revision: output.inputRevision - 1 }, context), { code: 'STALE_REVISION' });
  const plan = planCommand(s, admin, 'resolveTie', data, context);
  s = apply(s, plan);
  assert.deepEqual(plan.result.draw, [...data.entry_ids].reverse());
  assert.equal(s.matches.length, 4);
  assert.equal(s.stages.find(row => row.module_id === 'qualify')!.state, 'completed');
  const final = s.matches.find(m => String(m.logical_key).startsWith('playoff:'))!;
  const teamA = s.teams.find(t => t.id === final.team_a_id)!, teamB = s.teams.find(t => t.id === final.team_b_id)!;
  const finalContext = { ...context, now: new Date(clock + 30 * 60_000).toISOString() };
  s = apply(s, planCommand(s, admin, 'startMatch', { match_id: final.id }, finalContext));
  s = apply(s, planCommand(s, players[String(teamA.name).charCodeAt(0) - 65], 'submitScore', { match_id: final.id, score_a: 11, score_b: 9 }, finalContext));
  s = apply(s, planCommand(s, players[String(teamB.name).charCodeAt(0) - 65], 'confirmScore', { match_id: final.id, result_revision: s.matches.find(m => m.id === final.id)!.result_revision }, finalContext));
  assert.equal(s.event!.modular_state, 'completed');
  const finalRanking = s.stages.find(row => row.module_id === 'standings')!.output as { rankingDraws: { entryIds: string[] }[] };
  assert.deepEqual(finalRanking.rankingDraws[0].entryIds, plan.result.draw);
});


test('scores can be recorded directly from a scheduled match without a separate start command', () => {
 let s = ready(); s = apply(s, planCommand(s, owner, 'startTournament', {}, context));
 const m=s.matches[0];
 const data={match_id:m.id,score_a:11,score_b:5,outcome_kind:'played',reason:'Administrator validated the entered score.'};
 assert.throws(()=>planCommand(s,a,'attestScore',data,context),{code:'FORBIDDEN'});
 const plan=planCommand(s,admin,'attestScore',data,context);
 const result=apply(s,plan);
 assert.equal(result.matches[0].status,'validated');
 assert.equal(result.matches[0].started_at,undefined);
 assert.equal(result.event!.modular_state,'completed');
 assert.doesNotThrow(()=>previewCorrection(result,admin,{match_id:m.id,outcome_kind:'played',score_a:11,score_b:6}));
 assert.throws(()=>planCommand({...s,matches:[{...m,team_b_id:null}]},admin,'attestScore',data,context),{code:'INVALID_STATE'});
 const provisional=planCommand(s,a,'submitScore',{match_id:m.id,score_a:11,score_b:5},context);
 assert.equal(provisional.effects.matches![0].status,'score_entered');
});

test('guest enrollment requires real Picktennt accounts', () => {
 assert.throws(()=>planCommand(published(),owner,'addGuestEntry',{definition_id:id(),player_names:['Guest'],reason:'No account'},context),{code:'ACCOUNT_REQUIRED'});
});
test('administrator registered entries preserve profile identity without fabricating personal consent and finish a tournament', () => {
 let s=published();const data={definition_id:s.event!.definition_id,player_ids:[a.id],entry_name:'Registered A',reason:'Organizer enrolled this existing account.'};
 const plan=planCommand(s,owner,'addRegisteredEntry',data,context);
 assert.equal(plan.effects.teams![0].admin_definition_id,data.definition_id);assert.equal(plan.effects.teams![0].registered_by,owner.id);
 assert.deepEqual(plan.effects.team_members!.map(m=>({user_id:m.user_id,admission_source:m.admission_source,consented_at:m.consented_at,consented_definition_id:m.consented_definition_id,membership_status:m.membership_status})),[{user_id:a.id,admission_source:'administrator',consented_at:null,consented_definition_id:null,membership_status:'active'}]);
 assert.equal(plan.effects.tournament_players![0].user_id,a.id);assert.equal(plan.effects.tournament_players![0].status,'approved');
 s=apply(s,plan);s=apply(s,planCommand(s,admin,'addRegisteredEntry',{...data,player_ids:[b.id],entry_name:'Registered B'},context));
 assert.throws(()=>planCommand(s,a,'requestEntry',{definition_id:data.definition_id,consent:true,entry_name:'Duplicate self request'},context),{code:'DUPLICATE_ENTRY'});
 assert.throws(()=>planCommand(s,owner,'addRegisteredEntry',{...data,player_ids:[id()]},context),{code:'CAPACITY_FULL'});
 s=apply(s,planCommand(s,admin,'closeRegistration',{},context));
 s=apply(s,planCommand(s,admin,'lockRoster',{reviewed_roster_revision:s.event!.roster_revision},context));
 s=apply(s,planCommand(s,admin,'startTournament',{},context));
 s=apply(s,planCommand(s,admin,'attestScore',{match_id:s.matches[0].id,score_a:11,score_b:5,outcome_kind:'played',reason:'Reviewed result'},context));
 assert.equal(s.event!.modular_state,'completed');assert.ok(s.team_members.every(m=>m.consented_at===null));
});
test('registered doubles enforce distinct UUID cardinality, reason, name and strict fields', () => {
 const d=definition();d.registration.entry_type='fixed_doubles';d.registration.partner_consent=true;
 const s=published(d),data={definition_id:s.event!.definition_id,player_ids:[a.id,b.id],entry_name:'Two profiles',reason:'Enrolled by administrator'};
 for(const player_ids of [[],[a.id],[a.id,b.id,id()],[a.id,a.id],['not-a-uuid',b.id],[a.id.toUpperCase(),a.id]])assert.throws(()=>planCommand(s,admin,'addRegisteredEntry',{...data,player_ids},context),{code:'INVALID_REQUEST'});
 for(const patch of [{reason:''},{entry_name:' '},{entry_name:'x'.repeat(121)},{reason:'x'.repeat(1001)},{consent:true},{admission_source:'self'}])assert.throws(()=>planCommand(s,admin,'addRegisteredEntry',{...data,...patch},context),{code:'INVALID_REQUEST'});
 assert.equal(planCommand(s,admin,'addRegisteredEntry',data,context).effects.team_members!.length,2);
});
test('registered enrollment requires administrator permission, current definition, open deadline and unique current memberships', () => {
 let s=published();const data={definition_id:s.event!.definition_id,player_ids:[a.id],entry_name:'Registered A',reason:'Administrator registration'};
 assert.throws(()=>planCommand(s,a,'addRegisteredEntry',data,context),{code:'FORBIDDEN'});
 assert.throws(()=>planCommand(s,{...admin,clientId:'connector'},'addRegisteredEntry',data,context),{code:'FORBIDDEN'});
 assert.doesNotThrow(()=>planCommand(s,{...admin,clientId:'connector',permissions:['admin:manage']},'addRegisteredEntry',data,context));
 assert.throws(()=>planCommand(s,admin,'addRegisteredEntry',{...data,definition_id:id()},context),{code:'STALE_PREVIEW'});
 assert.throws(()=>planCommand(s,admin,'addRegisteredEntry',data,{...context,now:'2026-11-08T00:00:00Z'}),{code:'REGISTRATION_CLOSED'});
 s=register(s,a);assert.throws(()=>planCommand(s,admin,'addRegisteredEntry',data,context),{code:'DUPLICATE_ENTRY'});
 const pending=published();pending.teams.push({id:id(),entry_state:'pending'});pending.team_members.push({id:id(),team_id:pending.teams[0].id,user_id:a.id,membership_status:'pending',consented_at:null});
 assert.throws(()=>planCommand(pending,admin,'addRegisteredEntry',{...data,definition_id:pending.event!.definition_id},context),{code:'DUPLICATE_ENTRY'});
 s=apply(s,planCommand(s,owner,'closeRegistration',{},context));assert.throws(()=>planCommand(s,admin,'addRegisteredEntry',data,context),{code:'INVALID_STATE'});
});
test('roster lock refuses administrator admissions bound to other definitions and historical guest entries', () => {
 let s=published();const data={definition_id:s.event!.definition_id,player_ids:[a.id],entry_name:'A',reason:'Administrator registration'};
 s=apply(s,planCommand(s,owner,'addRegisteredEntry',data,context));s=apply(s,planCommand(s,owner,'addRegisteredEntry',{...data,player_ids:[b.id],entry_name:'B'},context));
 s=apply(s,planCommand(s,owner,'closeRegistration',{},context));
 const stale=structuredClone(s);stale.teams[0].admin_definition_id=id();
 assert.throws(()=>planCommand(stale,owner,'lockRoster',{reviewed_roster_revision:stale.event!.roster_revision},context),{code:'INCOMPLETE_ROSTER'});
 const guest=structuredClone(s);guest.teams[0].guest_players=[{id:id(),name:'Historical guest'}];guest.teams[0].guest_definition_id=data.definition_id;
 assert.throws(()=>planCommand(guest,owner,'lockRoster',{reviewed_roster_revision:guest.event!.roster_revision},context),{code:'INCOMPLETE_ROSTER'});
});
test('canceling an administrator-enrolled entry rejects every player projection without inventing consent', () => {
 for(const doubles of [false,true]){
  const d=definition();if(doubles){d.registration.entry_type='fixed_doubles';d.registration.partner_consent=true;}
  let s=published(d);const data={definition_id:s.event!.definition_id,player_ids:doubles?[a.id,b.id]:[a.id],entry_name:'Registered account entry',reason:'Administrator enrollment'};
  s=apply(s,planCommand(s,owner,'addRegisteredEntry',data,context));const oldTeam=s.teams[0];
  const plan=planCommand(s,a,'cancelEntry',{entry_id:oldTeam.id},context);
  assert.equal(plan.effects.teams![0].entry_state,'cancelled');assert.ok(plan.effects.team_members!.every(member=>member.membership_status==='cancelled'));
  assert.equal(plan.effects.tournament_players!.length,data.player_ids.length);assert.ok(plan.effects.tournament_players!.every(player=>player.status==='rejected'));
  s=apply(s,plan);assert.ok(s.team_members.every(member=>member.consented_at===null&&member.consented_definition_id===null));
  assert.doesNotThrow(()=>planCommand(s,owner,'addRegisteredEntry',data,context));
 }
});
