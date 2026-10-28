import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCommand, type CommandActor, type CommandContext, type CommandPlan, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { definitionHash } from '../../lib/tournament-builder/requests';

let seq = 8000, clock = Date.parse('2026-10-28T16:00:00Z');
const id = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
const host: CommandActor = { id: id(), clientId: 'web', role: 'owner' };
const admin: CommandActor = { id: id(), clientId: 'web', role: 'admin' };
const ctx = (): CommandContext => ({ now: new Date(clock).toISOString(), id, draw: ids => [...ids] });
function apply(s: CommandSnapshot, p: CommandPlan): CommandSnapshot {
  const n = structuredClone(s);
  n.event = { id: n.event?.id ?? id(), created_by: host.id, revision: 0, roster_revision: 0, result_version: 0, ...n.event, ...p.effects.event };
  n.event.revision = Number(n.event.revision) + 1;
  if (p.effects.definition) { const i = n.definitions.findIndex(r => r.id === p.effects.definition!.id); if (i < 0) n.definitions.push(p.effects.definition); else n.definitions[i] = { ...n.definitions[i], ...p.effects.definition }; }
  for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) for (const patch of p.effects[table] ?? []) {
    const i = n[table].findIndex(r => r.id === patch.id); if (i < 0) n[table].push(patch); else n[table][i] = { ...n[table][i], ...patch };
  }
  return n;
}
function setup(n: number, format: 'direct' | 'rr' | 'combined' = 'direct', start = true, lock = true): CommandSnapshot {
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  definition.registration = { ...definition.registration, mode: 'open', entry_type: 'singles', partner_consent: false, min_entries: 2, max_entries: n };
  definition.event.courts = 2;
  if (format === 'direct') definition.nodes = [definition.nodes[0], definition.nodes[1], { id: 'playoff', module: 'elimination@1', from: 'roster', config: { seeding: 'draw', bronze: false } }, { id: 'result', module: 'placements@1', from: 'playoff' }];
  if (format === 'rr') definition.nodes = definition.nodes.slice(0, 4).concat({ id: 'result', module: 'placements@1', from: 'rank' });
  if (format === 'combined' && n < 4) definition.nodes.find((node: { module: string }) => node.module === 'qualify@1').config.count = 2;
  let s: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  s = apply(s, planCommand(s, host, 'createDraft', { definition }, ctx()));
  s = apply(s, planCommand(s, host, 'publishTournament', { reviewed_definition_hash: definitionHash(definition), acknowledged_warning_codes: [] }, ctx()));
  for (let i = 0; i < n; i++) s = apply(s, planCommand(s, { id: id(), clientId: 'web' }, 'requestEntry', { consent: true, definition_id: s.event!.definition_id, entry_name: String.fromCharCode(65 + i) }, ctx()));
  if (!lock) return s;
  s = apply(s, planCommand(s, admin, 'closeRegistration', {}, ctx()));
  s = apply(s, planCommand(s, admin, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision }, ctx()));
  return start ? apply(s, planCommand(s, admin, 'startTournament', {}, ctx())) : s;
}
function finish(s: CommandSnapshot, matchId: string, winningName?: string): CommandSnapshot {
  clock += 30 * 60_000;
  const m = s.matches.find(r => r.id === matchId)!;
  const a = s.team_members.find(r => r.team_id === m.team_a_id)!, b = s.team_members.find(r => r.team_id === m.team_b_id)!;
  const teamA = s.teams.find(r => r.id === m.team_a_id)!, teamB = s.teams.find(r => r.id === m.team_b_id)!;
  const winner = winningName ?? [String(teamA.name), String(teamB.name)].sort()[0];
  s = apply(s, planCommand(s, admin, 'startMatch', { match_id: m.id }, ctx()));
  s = apply(s, planCommand(s, { id: String(a.user_id), clientId: 'web' }, 'submitScore', { match_id: m.id, score_a: teamA.name === winner ? 11 : 5, score_b: teamB.name === winner ? 11 : 5 }, ctx()));
  return apply(s, planCommand(s, { id: String(b.user_id), clientId: 'web' }, 'confirmScore', { match_id: m.id, result_revision: s.matches.find(r => r.id === m.id)!.result_revision }, ctx()));
}
function corrected(m: CommandSnapshot['matches'][number]) { return { match_id: m.id, score_a: Number(m.score_b), score_b: Number(m.score_a) }; }
function commit(s: CommandSnapshot, data: ReturnType<typeof corrected>, resolution: 'ordinary' | 'void_and_replay' = 'ordinary'): CommandSnapshot {
  const preview = previewCorrection(s, admin, data);
  return apply(s, planCommand(s, admin, 'commitCorrection', { ...data, preview_hash: preview.preview_hash, reason: 'Reviewed score correction.', resolution }, ctx()));
}
test('ordinary correction updates only changed unstarted dependencies and binds an immutable preview', () => {
  let s = setup(4); const semis = s.matches.filter(m => String(m.logical_key).includes(':r1:'));
  s = finish(s, semis[0].id); s = finish(s, semis[1].id);
  const source = s.matches.find(m => m.id === semis[0].id)!, untouched = structuredClone(s.matches.find(m => m.id === semis[1].id)!);
  const final = s.matches.find(m => String(m.logical_key).includes(':r2:'))!;
  const before = JSON.stringify(s), data = corrected(source), preview = previewCorrection(s, admin, data);
  assert.equal(JSON.stringify(s), before); assert.deepEqual(preview.affected_match_ids, [final.id]);
  assert.deepEqual(preview.started_dependent_ids, []);
  assert.throws(() => planCommand({ ...s, event: { ...s.event!, revision: Number(s.event!.revision) + 1 } }, admin, 'commitCorrection', { ...data, preview_hash: preview.preview_hash, reason: 'Reviewed.', resolution: 'ordinary' }, ctx()), { code: 'STALE_PREVIEW' });
  s = commit(s, data);
  assert.deepEqual(s.matches.find(m => m.id === untouched.id), untouched);
  assert.equal(s.matches.find(m => m.id === final.id)![`team_${String(source.bracket_winner_fills_side)}_id`], source.team_b_id);
  assert.equal(s.matches.filter(m => m.is_current !== false).length, 3);
});
test('started dependents block ordinary correction; explicit replay archives only that chain and retains physical rest', () => {
  let s = setup(4); const semis = s.matches.filter(m => String(m.logical_key).includes(':r1:'));
  s = finish(s, semis[0].id); s = finish(s, semis[1].id);
  const source = s.matches.find(m => m.id === semis[0].id)!, final = s.matches.find(m => String(m.logical_key).includes(':r2:'))!;
  clock += 30 * 60_000; s = apply(s, planCommand(s, admin, 'startMatch', { match_id: final.id }, ctx()));
  const preview = previewCorrection(s, admin, corrected(source));
  assert.deepEqual(preview.started_dependent_ids, [final.id]);
  assert.throws(() => planCommand(s, admin, 'commitCorrection', { ...corrected(source), preview_hash: preview.preview_hash, reason: 'Reviewed.', resolution: 'ordinary' }, ctx()), { code: 'DOWNSTREAM_STARTED' });
  const replayPlan = planCommand(s, admin, 'commitCorrection', { ...corrected(source), preview_hash: preview.preview_hash, reason: 'Reviewed.', resolution: 'void_and_replay' }, ctx());
  const patches = replayPlan.effects.matches!;
  const feeder = patches.find(m => m.id === source.id)!, targetId = feeder.bracket_next_winner_match_id;
  assert.ok(patches.findIndex(m => m.id === targetId) < patches.findIndex(m => m.id === feeder.id), 'Immediate FK requires new successor before feeder update.');
  s = apply(s, replayPlan);
  const historical = s.matches.find(m => m.id === final.id)!;
  assert.equal(historical.is_current, false); assert.ok(historical.voided_at); assert.ok(historical.ended_at);
  const replay = s.matches.find(m => m.logical_key === final.logical_key && m.is_current !== false)!;
  assert.notEqual(replay.id, final.id); assert.equal(replay.status, 'scheduled');
  assert.equal(s.matches.find(m => m.id === semis[1].id)!.is_current, true);
  assert.doesNotThrow(() => planCommand(s, admin, 'startMatch', { match_id: replay.id }, ctx()));
});
test('incomplete RR withdrawal retains accepted facts, retires a live match and excludes every pair statistic', () => {
  let s = setup(3, 'rr');
  const team = s.teams.find(t => t.name === 'A')!;
  const games = s.matches.filter(m => [m.team_a_id, m.team_b_id].includes(team.id));
  s = finish(s, games[0].id);
  const prior = structuredClone(s.matches.find(m => m.id === games[0].id)!);
  clock += 30 * 60_000; s = apply(s, planCommand(s, admin, 'startMatch', { match_id: games[1].id }, ctx()));
  const data = { entry_id: team.id, reason: 'withdrew' }, preview = previewWithdrawal(s, admin, data);
  assert.equal(preview.timing, 'incomplete_round_robin');
  s = apply(s, planCommand(s, admin, 'withdrawEntry', { ...data, preview_hash: preview.preview_hash }, ctx()));
  const old = s.matches.find(m => m.id === prior.id)!;
  assert.equal(old.score_a, prior.score_a); assert.equal(old.winner_team_id, prior.winner_team_id); assert.ok(old.excluded_at);
  const retired = s.matches.find(m => m.id === games[1].id)!;
  assert.equal(retired.outcome_kind, 'retirement'); assert.ok(retired.ended_at); assert.equal(retired.status, 'validated');
  const rows = (s.stages.find(stage => stage.module_id === 'standings')!.output as { rows: { entryId: string; wins: number; pointsFor: number }[] }).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.wins === 0 && row.pointsFor === 0));
  assert.equal(s.team_members.find(m => m.team_id === team.id)!.membership_status, 'withdrawn');
});
test('completed RR withdrawal backfills only before any playoff starts', () => {
  let s = setup(5, 'combined'); const rr = s.matches.filter(m => String(m.logical_key).startsWith('rr:'));
  for (const m of rr) s = finish(s, m.id);
  const d = s.teams.find(t => t.name === 'D')!, e = s.teams.find(t => t.name === 'E')!;
  const before = previewWithdrawal(s, admin, { entry_id: d.id, reason: 'withdrew' });
  assert.equal(before.timing, 'completed_rr_before_playoff');
  const replaced = apply(s, planCommand(s, admin, 'withdrawEntry', { entry_id: d.id, reason: 'withdrew', preview_hash: before.preview_hash }, ctx()));
  assert.ok((replaced.stages.find(stage => stage.module_id === 'qualify')!.output as { entryIds: string[] }).entryIds.includes(e.id));
  const unaffected = s.matches.find(m => String(m.logical_key).startsWith('playoff:') && m.team_a_id !== d.id && m.team_b_id !== d.id && m.team_a_id && m.team_b_id)!;
  clock += 30 * 60_000; s = apply(s, planCommand(s, admin, 'startMatch', { match_id: unaffected.id }, ctx()));
  const after = previewWithdrawal(s, admin, { entry_id: d.id, reason: 'withdrew' });
  assert.equal(after.timing, 'playoffs_started');
  const pinned = apply(s, planCommand(s, admin, 'withdrawEntry', { entry_id: d.id, reason: 'withdrew', preview_hash: after.preview_hash }, ctx()));
  assert.ok(!(pinned.stages.find(stage => stage.module_id === 'qualify')!.output as { entryIds: string[] }).entryIds.includes(e.id));
  assert.equal(pinned.matches.find(m => m.id === unaffected.id)!.status, 'in_progress');
  assert.ok(pinned.matches.some(m => m.outcome_kind === 'walkover'));
});
test('withdrawal before first play archives the generation and requires an explicit legal relock', () => {
  let s = setup(4, 'direct', false); const original = s.matches.map(m => m.id), entryId = s.teams[0].id;
  const data = { entry_id: entryId, reason: 'withdrew' }, p = previewWithdrawal(s, admin, data);
  assert.equal(p.timing, 'locked_before_play');
  s = apply(s, planCommand(s, admin, 'withdrawEntry', { ...data, preview_hash: p.preview_hash }, ctx()));
  assert.equal(s.event!.modular_state, 'registration_closed');
  assert.ok(original.every(matchId => s.matches.find(m => m.id === matchId)!.is_current === false));
  assert.throws(() => planCommand(s, admin, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision }, ctx()), { code: 'INVALID_CAPACITY' });
});
test('court changes are bounded, reject same-wave collisions and never move a started fixture', () => {
  let s = setup(4, 'rr', false); const game = s.matches.find(m => m.court_number === 1)!, other = s.matches.find(m => m.round_id === game.round_id && m.court_number === 2)!;
  assert.ok(other);
  assert.throws(() => planCommand(s, admin, 'changeCourt', { match_id: game.id, court_number: 3 }, ctx()), { code: 'INVALID_REQUEST' });
  assert.throws(() => planCommand(s, admin, 'changeCourt', { match_id: game.id, court_number: 2 }, ctx()), { code: 'COURT_BUSY' });
  s = apply(s, planCommand(s, admin, 'startTournament', {}, ctx()));
  s = apply(s, planCommand(s, admin, 'startMatch', { match_id: game.id }, ctx()));
  assert.throws(() => planCommand(s, admin, 'changeCourt', { match_id: game.id, court_number: 1 }, ctx()), { code: 'INVALID_STATE' });
});
test('RR cutoff correction preserves an unrelated live semifinal and changes only the affected branch', () => {
  let s = setup(5, 'combined'); for (const game of [...s.matches]) s = finish(s, game.id);
  const d = s.teams.find(t => t.name === 'D')!, e = s.teams.find(t => t.name === 'E')!;
  const source = s.matches.find(m => [m.team_a_id, m.team_b_id].includes(d.id) && [m.team_a_id, m.team_b_id].includes(e.id))!;
  const untouched = s.matches.find(m => String(m.logical_key).startsWith('playoff:') && m.team_a_id && m.team_b_id && ![m.team_a_id, m.team_b_id].includes(d.id))!;
  clock += 30 * 60_000; s = apply(s, planCommand(s, admin, 'startMatch', { match_id: untouched.id }, ctx()));
  const original = structuredClone(s.matches.find(m => m.id === untouched.id)!);
  const preview = previewCorrection(s, admin, corrected(source));
  assert.ok(!preview.affected_match_ids.includes(untouched.id)); assert.deepEqual(preview.started_dependent_ids, []);
  s = commit(s, corrected(source));
  assert.deepEqual(s.matches.find(m => m.id === untouched.id), original);
  assert.ok((s.stages.find(stage => stage.module_id === 'qualify')!.output as { entryIds: string[] }).entryIds.includes(e.id));
});
test('a correction creating an exact seed tie pauses replay until a new recorded draw', () => {
  let s = setup(3, 'combined'); for (const game of [...s.matches]) s = finish(s, game.id);
  const a = s.teams.find(t => t.name === 'A')!, c = s.teams.find(t => t.name === 'C')!;
  const source = s.matches.find(m => [m.team_a_id, m.team_b_id].includes(a.id) && [m.team_a_id, m.team_b_id].includes(c.id))!;
  const final = s.matches.find(m => String(m.logical_key).startsWith('playoff:'))!;
  clock += 30 * 60_000; s = apply(s, planCommand(s, admin, 'startMatch', { match_id: final.id }, ctx()));
  const preview = previewCorrection(s, admin, corrected(source));
  assert.equal(preview.qualification_pending, true);
  s = commit(s, corrected(source), 'void_and_replay');
  assert.equal(s.matches.filter(m => m.is_current !== false && String(m.logical_key).startsWith('playoff:')).length, 0);
  const rank = s.stages.find(stage => stage.module_id === 'standings')!, output = rank.output as { inputRevision: number; ties: string[][] };
  assert.equal(rank.state, 'blocked'); assert.equal(output.ties[0].length, 3);
  assert.equal(s.stages.find(stage => stage.module_id === 'elimination')!.state, 'blocked');
  s = apply(s, planCommand(s, admin, 'resolveTie', { stage_id: rank.id, input_revision: output.inputRevision, entry_ids: output.ties[0] }, ctx()));
  assert.equal(s.matches.filter(m => m.is_current !== false && String(m.logical_key).startsWith('playoff:')).length, 1);
});
test('insufficient replacements retain an empty qualifier slot and create an audited walkover', () => {
  let s = setup(4, 'combined'); for (const game of [...s.matches]) s = finish(s, game.id);
  const entryId = s.teams.find(t => t.name === 'D')!.id;
  const p = previewWithdrawal(s, admin, { entry_id: entryId, reason: 'withdrew' });
  assert.equal(p.empty_qualifier_slots, true);
  s = apply(s, planCommand(s, admin, 'withdrawEntry', { entry_id: entryId, reason: 'withdrew', preview_hash: p.preview_hash }, ctx()));
  assert.ok(s.matches.some(m => m.outcome_kind === 'walkover'));
  assert.equal(s.event!.modular_state, 'active');
});
test('own cancellation before lock frees capacity and does not require admin impersonation', () => {
  let s = setup(4, 'rr', false, false); const team = s.teams[0], member = s.team_members.find(m => m.team_id === team.id)!;
  const actor = { id: String(member.user_id), clientId: 'web' }, data = { entry_id: team.id, reason: 'withdrew' };
  const p = previewWithdrawal(s, actor, data); assert.equal(p.timing, 'before_lock');
  s = apply(s, planCommand(s, actor, 'withdrawEntry', { ...data, preview_hash: p.preview_hash }, ctx()));
  assert.equal(s.teams.find(t => t.id === team.id)!.entry_state, 'cancelled');
  s = apply(s, planCommand(s, { id: id(), clientId: 'web' }, 'requestEntry', { consent: true, definition_id: s.event!.definition_id }, ctx()));
  assert.equal(s.teams.filter(t => t.entry_state === 'approved').length, 4);
});
test('completed corrections require owner reopening and create a new result version', () => {
  let s = setup(2); s = finish(s, s.matches[0].id);
  const source = s.matches[0], data = corrected(source), p = previewCorrection(s, admin, data);
  assert.equal(p.requires_reopen, true);
  assert.throws(() => planCommand(s, admin, 'commitCorrection', { ...data, preview_hash: p.preview_hash, reason: 'Reviewed.', resolution: 'ordinary' }, ctx()), { code: 'INVALID_STATE' });
  s = apply(s, planCommand(s, host, 'reopenResults', { reason: 'Review accepted result.' }, ctx()));
  s = commit(s, data);
  assert.equal(s.event!.modular_state, 'completed'); assert.equal(s.event!.result_version, 2);
  assert.equal(s.matches[0].winner_team_id, source.team_b_id);
});
test('no eligible champion blocks new completion and owner cancellation closes without a winner', () => {
  let s = setup(2); clock += 30 * 60_000;
  s = apply(s, planCommand(s, admin, 'startMatch', { match_id: s.matches[0].id }, ctx()));
  for (const entryId of s.teams.map(t => t.id)) {
    if (s.event!.modular_state === 'completed') s = apply(s, planCommand(s, host, 'reopenResults', { reason: 'Review eligibility.' }, ctx()));
    const data = { entry_id: entryId, reason: 'withdrew' }, p = previewWithdrawal(s, admin, data);
    s = apply(s, planCommand(s, admin, 'withdrawEntry', { ...data, preview_hash: p.preview_hash }, ctx()));
  }
  const placement = s.stages.find(stage => stage.module_id === 'placements')!;
  assert.equal(placement.state, 'blocked'); assert.equal((placement.output as { blockedCode: string }).blockedCode, 'NO_ELIGIBLE_CHAMPION');
  s = apply(s, planCommand(s, host, 'cancelTournament', { reason: 'No eligible champion.' }, ctx()));
  assert.equal(s.event!.modular_state, 'cancelled');
});
test('retirement preserves informational partial points and a physically started match cannot become a walkover', () => {
  let s = setup(3, 'rr'), match = s.matches[0]; clock += 30 * 60_000;
  s = apply(s, planCommand(s, admin, 'startMatch', { match_id: match.id }, ctx()));
  assert.throws(() => planCommand(s, admin, 'attestScore', { match_id: match.id, outcome_kind: 'walkover', winner_entry_id: match.team_a_id, reason: 'No-show' }, ctx()), { code: 'INVALID_STATE' });
  s = apply(s, planCommand(s, admin, 'attestScore', { match_id: match.id, outcome_kind: 'retirement', winner_entry_id: match.team_a_id, score_a: 3, score_b: 2, reason: 'Entry retired.' }, ctx()));
  match = s.matches.find(m => m.id === match.id)!;
  assert.equal(match.score_a, 3); assert.equal(match.score_b, 2); assert.ok(match.ended_at);
  const rows = (s.stages.find(stage => stage.module_id === 'standings')!.output as { rows: { wins: number; pointsFor: number }[] }).rows;
  assert.equal(rows.reduce((sum, row) => sum + row.wins, 0), 1); assert.ok(rows.every(row => row.pointsFor === 0));
  assert.throws(() => previewCorrection(s, admin, { match_id: match.id, outcome_kind: 'walkover', winner_entry_id: match.winner_team_id }), { code: 'INVALID_STATE' });
});
test('command names inherited from Object never enter the allowlist', () => {
  const s: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  for (const name of ['toString', '__proto__', 'constructor']) assert.throws(() => planCommand(s, host, name, {}, ctx()), { code: 'INVALID_COMMAND' });
});
