import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner, stranger } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewAppendTerminalMatch, planAppendTerminalMatch } from '../../lib/tournament-builder/append-terminal-match';
import { callTournamentTool, type McpDependencies } from '../../lib/tournament-builder/mcp';

let db: PGlite;
before(async () => { db = await storageDatabase(); });
after(async () => { await db?.close(); });
const actor = { id: owner, clientId: 'web' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
const empty = (): CommandSnapshot => ({ event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] });
async function snapshot(event: string) { return role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value); }
async function apply(event: string, name: string, data: Record<string, unknown>, initial?: CommandSnapshot, user = actor) {
  const current = initial ?? await snapshot(event), plan = planCommand(current, user, name, data, context);
  await command(db, { actor: user.id, event, command: name, revision: current.event ? Number(current.event.revision) : null, request: data, effects: plan.effects, result: plan.result });
  return snapshot(event);
}
async function fixture(hasBronze = false) {
  const event = randomUUID(), d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  const now = Date.now();
  d.event.timezone = 'UTC';
  d.registration.closes_at = new Date(now + 30 * 86400000).toISOString();
  d.event.starts_at = new Date(now + 31 * 86400000).toISOString();
  d.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
  d.schema_version = '2.0'; d.registration.min_entries = d.registration.max_entries = 4;
  const seed = (value: number) => ({ kind: 'seed', seed: value });
  d.nodes = [{ id: 'reg', module: 'registration@1' }, { id: 'roster', module: 'entries@1', from: 'reg' }, { id: 'left', module: 'match@1', inputs: [seed(1), seed(2)] }, { id: 'right', module: 'match@1', inputs: [seed(3), seed(4)] }, { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'left' }, { kind: 'winner', node_id: 'right' }] }];
  if (hasBronze) d.nodes.push({ id: 'bronze', module: 'match@1', inputs: [{ kind: 'loser', node_id: 'left' }, { kind: 'loser', node_id: 'right' }] });
  d.nodes.push({ id: 'placements', module: 'placements@2', final: 'final', ...(hasBronze ? { bronze: 'bronze' } : {}) });
  let current = await apply(event, 'createDraft', { definition: d }, empty());
  const publication = previewDefinition(d, Number(current.event!.revision));
  current = await apply(event, 'publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes });
  const users = Array.from({ length: 8 }, () => randomUUID()), definitionId = String(current.event!.definition_id);
  for (const [index, user] of users.entries()) await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [user, `${user}@example.invalid`, JSON.stringify({ given_name: `Player ${index}` })]);
  for (const user of users) current = await apply(event, 'joinTournament', { definition_id: definitionId, consent: true }, undefined, { id: user, clientId: 'web' });
  for (let index = 0; index < 4; index++) current = await apply(event, 'addRegisteredEntry', { definition_id: definitionId, player_ids: users.slice(index * 2, index * 2 + 2), entry_name: `Pair ${index + 1}`, reason: 'Registered accounts' });
  current = await apply(event, 'closeRegistration', {}); current = await apply(event, 'lockRoster', { reviewed_roster_revision: current.event!.roster_revision }); current = await apply(event, 'startTournament', {});
  while (current.event!.modular_state !== 'completed') {
    const match = current.matches.find(row => row.status === 'scheduled' && row.team_a_id && row.team_b_id);
    assert.ok(match); current = await apply(event, 'attestScore', { match_id: match.id, outcome_kind: 'played', score_a: 11, score_b: 1, reason: 'Observed score' });
  }
  const final = current.matches.find(match => match.logical_key === 'final:match')!;
  current = await apply(event, 'setDuprSubmission', { match_id: final.id, enabled: true });
  current = await apply(event, 'reopenResults', { reason: 'Add an additional placement game' });
  return { event, d, current, final };
}
test('append terminal match is atomic, preserves history and recalculates placements after scoring', async () => {
  const { event, d, final } = await fixture(); let current = await snapshot(event);
  const nodes = structuredClone(d.nodes);
  nodes.splice(nodes.length - 1, 0, { id: 'bronze', module: 'match@1', inputs: [{ kind: 'loser', node_id: 'left' }, { kind: 'loser', node_id: 'right' }] });
  nodes.find((node: { id: string }) => node.id === 'placements').bronze = 'bronze';
  const proposal = { nodes, reason: 'Add third place' }, reviewed = previewAppendTerminalMatch(current, actor, proposal), data = { ...proposal, preview_hash: reviewed.preview_hash };
  const plan = planAppendTerminalMatch(current, actor, data, context), revision = Number(current.event!.revision), operation = randomUUID();
  assert.throws(() => previewAppendTerminalMatch({ ...current, event: { ...current.event!, results_under_review: false } }, actor, proposal), { code: 'INVALID_STATE' });
  await db.exec('SET session_replication_role = replica');
  try { await db.query('UPDATE public.tournaments SET results_under_review=false WHERE id=$1', [event]); }
  finally { await db.exec('SET session_replication_role = origin'); }
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result }), /INVALID_STATE/);
  await db.exec('SET session_replication_role = replica');
  try { await db.query('UPDATE public.tournaments SET results_under_review=true WHERE id=$1', [event]); }
  finally { await db.exec('SET session_replication_role = origin'); }
  const placementStageId = current.stages.find(stage => stage.module_id === 'placements')!.id;
  await db.exec('SET session_replication_role = replica');
  try { await db.query("UPDATE public.tournament_stages SET state='waiting' WHERE id=$1", [placementStageId]); }
  finally { await db.exec('SET session_replication_role = origin'); }
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result }), /INVALID_STATE/);
  await db.exec('SET session_replication_role = replica');
  try { await db.query("UPDATE public.tournament_stages SET state='blocked' WHERE id=$1", [placementStageId]); }
  finally { await db.exec('SET session_replication_role = origin'); }
  const badEffect = structuredClone(plan.effects); badEffect.matches![0].submit_to_dupr = true;
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: badEffect, result: plan.result }), /INVALID_EFFECTS/);
  const badOldScore = structuredClone(plan.effects); badOldScore.matches![1].score_a = 0;
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: badOldScore, result: plan.result }), /INVALID_EFFECTS/);
  await assert.rejects(command(db, { actor: stranger, event, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result }), /FORBIDDEN/);
  for (const value of [undefined, null]) {
    const forged = structuredClone(data); forged.nodes.find((node: { id: string }) => node.id === 'bronze').inputs[0].kind = value;
    await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: forged, effects: plan.effects, result: plan.result }), /INVALID_DEFINITION|UNSUPPORTED_FORMAT/);
  }
  const wrongBronze = structuredClone(data); wrongBronze.nodes.find((node: { id: string }) => node.id === 'bronze').inputs[1].node_id = 'left';
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: wrongBronze, effects: plan.effects, result: plan.result }), /INVALID_DEFINITION|INVALID_STATE/);
  const numeric = structuredClone(data); numeric.nodes.find((node: { id: string }) => node.id === 'bronze').id = 123; numeric.nodes.find((node: { id: string }) => node.id === 'placements').bronze = 123;
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: numeric, effects: plan.effects, result: plan.result }), /INVALID_DEFINITION|UNSUPPORTED_FORMAT/);
  const nullBronze = structuredClone(data); const placement = nullBronze.nodes.find((node: { id: string }) => node.id === 'placements'); placement.final = 'bronze'; placement.bronze = null;
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: nullBronze, effects: plan.effects, result: plan.result }), /INVALID_DEFINITION/);
  const staleStage = randomUUID(), staleMatch = randomUUID();
  await db.exec('SET session_replication_role = replica');
  try {
    await db.query("INSERT INTO public.tournament_stages(id,tournament_id,definition_id,node_id,module_id,module_version,state) VALUES($1,$2,$3,'stale','match',1,'completed')", [staleStage, event, current.event!.definition_id]);
    await db.query("INSERT INTO public.matches SELECT (jsonb_populate_record(NULL::public.matches,to_jsonb(m)||jsonb_build_object('id',$1::uuid,'stage_id',$2::uuid,'logical_key','stale:match'))).* FROM public.matches m WHERE m.id=$3", [staleMatch, staleStage, final.id]);
  } finally { await db.exec('SET session_replication_role = origin'); }
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result }), /INVALID_STATE/);
  await db.exec('SET session_replication_role = replica');
  try { await db.query('DELETE FROM public.matches WHERE id=$1', [staleMatch]); await db.query('DELETE FROM public.tournament_stages WHERE id=$1', [staleStage]); }
  finally { await db.exec('SET session_replication_role = origin'); }
  assert.equal(Number((await snapshot(event)).event!.revision), revision);
  const grant = randomUUID();
  await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)', [grant, owner, 'synthetic-test', 'connector', ['admin:manage']]);
  const connector = { id: owner, clientId: 'connector', grantId: grant, permissions: ['admin:manage'], role: 'owner' as const };
  const deps: McpDependencies = { execute: async (name, tournamentId, input) => { const envelope = input as { operation_id: string; expected_revision: number; data: Record<string, unknown> }; const planned = planCommand(current, connector, name, envelope.data, context); return command(db, { actor: owner, client: 'connector', grant, event: tournamentId!, operation: envelope.operation_id, command: name, revision: envelope.expected_revision, request: envelope.data, effects: planned.effects, result: planned.result }); }, getDraft: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}), admin: { snapshot: async () => current, findPlayer: async () => ({}), previewCorrection: async () => ({}), previewWithdrawal: async () => ({}), previewAppendTerminalMatch: async (_id, input) => previewAppendTerminalMatch(current, connector, input) } };
  const mcpReview = await callTournamentTool('admin_preview_append_terminal_match', { tournament_id: event, data: proposal }, deps) as typeof reviewed;
  assert.equal(mcpReview.preview_hash, reviewed.preview_hash);
  const args = { tournament_id: event, operation_id: operation, expected_revision: revision, data };
  await assert.rejects(callTournamentTool('admin_append_terminal_match', args, deps), { code: 'CONFIRMATION_REQUIRED' });
  await assert.rejects(callTournamentTool('admin_append_terminal_match', { ...args, data: proposal, confirmed_structure_change: true }, deps), { code: 'INVALID_REQUEST' });
  const receipt = await callTournamentTool('admin_append_terminal_match', { ...args, confirmed_structure_change: true }, deps);
  assert.deepEqual(await command(db, { actor: owner, client: 'connector', grant, event, operation, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result }), receipt);
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result }), /STALE_REVISION/);
  current = await snapshot(event);
  assert.equal(current.matches.find(match => match.id === final.id)!.score_a, 11); assert.equal(current.matches.find(match => match.id === final.id)!.submit_to_dupr, true);
  const bronze = current.matches.find(match => match.id === (receipt as { data: { match_id: string } }).data.match_id)!;
  assert.equal(bronze.status, 'scheduled'); assert.equal(bronze.submit_to_dupr, false);
  assert.equal(current.stages.find(stage => stage.module_id === 'placements')!.state, 'ready');
  assert.equal((current.stages.find(stage => stage.module_id === 'placements')!.output as Record<string, unknown>).championEntryId, undefined);
  current = await apply(event, 'attestScore', { match_id: bronze.id, outcome_kind: 'played', score_a: 11, score_b: 1, reason: 'Observed bronze' });
  assert.equal(current.event!.modular_state, 'completed');
  assert.equal((current.stages.find(stage => stage.module_id === 'placements')!.output as Record<string, unknown>).championEntryId, final.team_a_id);
  const history = await db.query<{ before_facts: CommandSnapshot; after_facts: CommandSnapshot }>('SELECT before_facts,after_facts FROM tournament_operations WHERE operation_id=$1', [operation]);
  assert.equal(history.rows[0].before_facts.matches.find(match => match.id === final.id)?.score_a, 11);
  assert.equal(history.rows[0].after_facts.matches.find(match => match.id === final.id)?.score_a, 11);
});
test('SQL rejects a forged new final incompatible with an existing bronze route', async () => {
  const { event, d, current } = await fixture(true), nodes = structuredClone(d.nodes);
  nodes.splice(nodes.length - 1, 0, { id: 'newfinal', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'final' }, { kind: 'loser', node_id: 'left' }] });
  nodes.find((node: { id: string }) => node.id === 'placements').final = 'newfinal';
  const request = { nodes, reason: 'Review new final', preview_hash: 'a'.repeat(64) };
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision: Number(current.event!.revision), request, effects: {}, result: {} }), /INVALID_DEFINITION/);
});
test('append a new final from winner and loser, keeping the previous final and DUPR selection', async () => {
  const { event, d, final } = await fixture(); let current = await snapshot(event);
  const nodes = structuredClone(d.nodes);
  nodes.splice(nodes.length - 1, 0, { id: 'newfinal', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'final' }, { kind: 'loser', node_id: 'final' }] });
  nodes.find((node: { id: string }) => node.id === 'placements').final = 'newfinal';
  const proposal = { nodes, reason: 'Add a final match' }, review = previewAppendTerminalMatch(current, actor, proposal);
  assert.equal(review.placement_mode, 'final');
  const data = { ...proposal, preview_hash: review.preview_hash }, plan = planAppendTerminalMatch(current, actor, data, context), revision = Number(current.event!.revision);
  const modified = structuredClone(data); modified.nodes.find((node: { id: string }) => node.id === 'left').inputs.reverse();
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: modified, effects: plan.effects, result: plan.result }), /UNSUPPORTED_FORMAT/);
  const removed = structuredClone(data); removed.nodes = removed.nodes.filter((node: { id: string }) => node.id !== 'left'); removed.nodes.push({ id: 'extra', module: 'match@1', inputs: [{ kind: 'loser', node_id: 'right' }, { kind: 'winner', node_id: 'right' }] });
  await assert.rejects(command(db, { event, command: 'appendTerminalMatch', revision, request: removed, effects: plan.effects, result: plan.result }), /UNSUPPORTED_FORMAT/);
  await command(db, { event, command: 'appendTerminalMatch', revision, request: data, effects: plan.effects, result: plan.result });
  current = await snapshot(event);
  const oldFinal = current.matches.find(match => match.id === final.id)!, newFinal = current.matches.find(match => match.id === plan.result.match_id)!;
  assert.equal(oldFinal.score_a, 11); assert.equal(oldFinal.submit_to_dupr, true); assert.equal(newFinal.status, 'scheduled');
  assert.equal(oldFinal.bracket_next_winner_match_id, newFinal.id); assert.equal(oldFinal.bracket_next_loser_match_id, newFinal.id);
  current = await apply(event, 'attestScore', { match_id: newFinal.id, outcome_kind: 'played', score_a: 1, score_b: 11, reason: 'Observed new final' });
  assert.equal(current.event!.modular_state, 'completed');
  const placement = current.stages.find(stage => stage.module_id === 'placements')!.output as { championEntryId: string; groups: { rank: number; entryIds: string[] }[] };
  assert.equal(placement.championEntryId, newFinal.team_b_id);
  assert.deepEqual(placement.groups.map(group => [group.rank, group.entryIds.length]), [[1, 1], [2, 1], [3, 2]]);
  assert.equal(new Set(placement.groups.flatMap(group => group.entryIds)).size, 4);
  assert.equal(current.matches.find(match => match.id === final.id)!.score_a, 11);
});
