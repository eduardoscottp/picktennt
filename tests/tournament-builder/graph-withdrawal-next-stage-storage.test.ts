import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

test('SQL validates automatic graph outcomes after two or three real withdrawals', async () => {
 const db = await storageDatabase();
 await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
 await db.exec(readFileSync('supabase/migrations/202611130004_graph_seed_pool_review.sql', 'utf8'));
 await db.exec(readFileSync('supabase/migrations/202611130005_graph_general_review.sql', 'utf8'));
 await db.exec(readFileSync('supabase/migrations/202611130006_graph_partial_auto_group.sql', 'utf8'));
 const actor = { id: owner, clientId: 'web' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
 const empty = (): CommandSnapshot => ({ event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] });
 try {
  for (const withdrawals of [2, 3, 4, 0]) {
   const event = randomUUID();
   const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
   definition.schema_version = '2.0'; definition.registration.mode = 'open'; definition.registration.entry_type = 'singles'; definition.registration.partner_consent = false;
   definition.registration.min_entries = definition.registration.max_entries = 4;
   const now = Date.now(); definition.event.timezone = 'UTC';
   definition.registration.closes_at = new Date(now + 30 * 86400000).toISOString(); definition.event.starts_at = new Date(now + 31 * 86400000).toISOString(); definition.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
   definition.nodes = [
    { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'rr', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })) },
    { id: 's1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'rr', rank: 1 }, { kind: 'rank', node_id: 'rr', rank: 4 }] },
    { id: 's2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'rr', rank: 2 }, { kind: 'rank', node_id: 'rr', rank: 3 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }] },
    { id: 'bronze', module: 'match@1', inputs: [{ kind: 'loser', node_id: 's1' }, { kind: 'loser', node_id: 's2' }] },
    { id: 'placements', module: 'placements@2', final: 'final', bronze: 'bronze' },
   ];
   const snapshot = async () => role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
   const run = async (name: string, request: Record<string, unknown>, initial?: CommandSnapshot) => {
    const before = initial ?? await snapshot(), plan = planCommand(before, actor, name, request, context);
    await command(db, { event, command: name, revision: before.event ? Number(before.event.revision) : null, request, effects: plan.effects, result: plan.result });
    return snapshot();
   };
   let current = await run('createDraft', { definition }, empty());
   const publication = previewDefinition(definition, Number(current.event!.revision));
   current = await run('publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes ?? [] });
   for (let i = 0; i < 4; i++) {
    const user = randomUUID();
    await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [user, `${user}@example.invalid`, JSON.stringify({ given_name: `Player ${i}` })]);
    current = await run('addRegisteredEntry', { definition_id: current.event!.definition_id, player_ids: [user], entry_name: `Player ${i}`, reason: 'Organizer enrolled verified player.' });
   }
   current = await run('closeRegistration', {}); current = await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision }); current = await run('startTournament', {});
   for (const match of current.matches) {
    const a = Number(current.teams.find(team => team.id === match.team_a_id)!.seed), b = Number(current.teams.find(team => team.id === match.team_b_id)!.seed);
    current = await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: a < b ? 11 : 2, score_b: a < b ? 2 : 11, reason: 'Verified result' });
   }
   const rosterOutput = current.stages.find(stage => stage.module_id === 'entries')!.output;
   const bindings = (await db.query<{ value: Record<string, string | null> }>('SELECT tournament_builder_private.graph_resolve_bindings($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) value', [event, current.event!.definition_id, JSON.stringify(definition.nodes), JSON.stringify(rosterOutput), JSON.stringify(definition.nodes.find(node => node.id === 's1'))])).rows[0].value;
   const ranks = (current.stages.find(stage => stage.node_id === 'rr')!.output as { rows: { entryId: string }[] }).rows;
   assert.deepEqual(Object.values(bindings).sort(), [ranks[0].entryId, ranks[3].entryId].sort());
   const future = (await db.query<{ value: Record<string, string | null> }>('SELECT tournament_builder_private.graph_resolve_bindings($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) value', [event, current.event!.definition_id, JSON.stringify(definition.nodes), JSON.stringify(rosterOutput), JSON.stringify(definition.nodes.find(node => node.id === 'final'))])).rows[0].value;
   assert.deepEqual(Object.values(future), [null, null]);
   if (withdrawals === 0) {
    const reviewed = previewNextStage(current, actor);
    if (reviewed.state !== 'ready') throw new Error('Expected initial review');
    current = await run('generateNextStage', { preview_hash: reviewed.preview_hash });
    const semifinal = current.matches.find(match => match.logical_key === 's1:match')!, entry_id = String(semifinal.team_a_id);
    const withdrawal = { entry_id, reason: 'Withdrawal after fixtures were fixed' }, withdrawalReview = previewWithdrawal(current, actor, withdrawal);
    current = await run('withdrawEntry', { ...withdrawal, preview_hash: withdrawalReview.preview_hash });
    const saved = current.matches.find(match => match.id === semifinal.id)!;
    assert.equal(saved.team_a_id, entry_id); assert.equal(saved.outcome_kind, 'walkover');
    const source = current.stages.find(stage => stage.node_id === 'rr')!;
    const sourceMatch = current.matches.find(match => match.stage_id === source.id && ![match.team_a_id, match.team_b_id].includes(entry_id) && match.outcome_kind === 'played')!;
    const proposal = { match_id: sourceMatch.id, score_a: sourceMatch.score_b, score_b: sourceMatch.score_a }, impact = previewCorrection(current, actor, proposal);
    assert.ok(impact.affected_match_ids.includes(semifinal.id));
    current = await run('commitCorrection', { ...proposal, preview_hash: impact.preview_hash, reason: 'Correct source after withdrawal', resolution: 'void_and_replay' });
    assert.equal(current.matches.find(match => match.id === semifinal.id)!.is_current, false);
    return;
   }
   const withdrawn = current.teams.slice(0, withdrawals).map(team => team.id);
   for (const entry_id of withdrawn) {
    const request = { entry_id, reason: 'Withdrawal after group' }, review = previewWithdrawal(current, actor, request);
    current = await run('withdrawEntry', { ...request, preview_hash: review.preview_hash });
   }
   const review = previewNextStage(current, actor);
   if (withdrawals === 4) {
    assert.equal(review.state, 'ready');
    if (review.state !== 'ready' || !('no_eligible_champion' in review) || !review.no_eligible_champion) throw new Error('Expected review without a champion');
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    const validate = (effects: unknown) => db.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify(request), JSON.stringify(effects)]);
    await validate(plan.effects);
    const bad = structuredClone(plan.effects); bad.event = { modular_state: 'completed', result_version: 999 };
    await assert.rejects(validate(bad), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: bad, result: plan.result }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
    assert.equal((await snapshot()).stages.find(stage => stage.node_id === 'placements')!.state, 'blocked');
    continue;
   }
   assert.equal(review.state, 'ready');
   if (review.state !== 'ready') throw new Error('Expected a reviewed automatic outcome');
   const plan = planCommand(current, actor, 'generateNextStage', { preview_hash: review.preview_hash }, context);
   await db.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify({ preview_hash: review.preview_hash }), JSON.stringify(plan.effects)]);
   assert.ok(plan.effects.matches?.some(match => match.outcome_kind === 'walkover' || match.outcome_kind === 'no_contest'));
   for (const nodeId of withdrawals === 2 ? ['s1', 'bronze'] : ['s1', 'final']) {
    const node = definition.nodes.find(item => item.id === nodeId)!, stage = current.stages.find(item => item.node_id === nodeId)!;
    const stagePatch = plan.effects.stages!.find(item => item.id === stage.id)!;
    const bindings = (await db.query<{ value: { values: unknown; known: unknown } }>('SELECT tournament_builder_private.graph_effective_bindings($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) value', [event, current.event!.definition_id, JSON.stringify(definition.nodes), JSON.stringify(rosterOutput), JSON.stringify(node), JSON.stringify(plan.effects.stages)])).rows[0].value;
    const validateMatch = (effects: typeof plan.effects, actorId = owner) => db.query('SELECT tournament_builder_private.validate_graph_auto_match($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::uuid,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::bigint,$12::integer,$13::bigint)', [event, actorId, JSON.stringify(node), JSON.stringify(rosterOutput), stage.id, JSON.stringify(stagePatch), JSON.stringify(effects.matches), JSON.stringify(bindings.values), JSON.stringify(bindings.known), JSON.stringify(effects.rounds), current.event!.roster_revision, definition.event.courts, Number(current.event!.revision) + 1]);
    await validateMatch(plan.effects);
    const bad = structuredClone(plan.effects); bad.matches!.find(item => item.logical_key === `${nodeId}:match`)!.validated_by = randomUUID();
    await assert.rejects(validateMatch(bad), /INVALID_EFFECTS/);
    const badWinner = structuredClone(plan.effects); badWinner.matches!.find(item => item.logical_key === `${nodeId}:match`)!.winner_team_id = randomUUID();
    await assert.rejects(validateMatch(badWinner), /INVALID_EFFECTS/);
   }
   const before = await snapshot();
   const forged = structuredClone(plan.effects);
   forged.matches!.find(match => match.outcome_kind === 'walkover')!.winner_team_id = randomUUID();
   await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request: { preview_hash: review.preview_hash }, effects: forged, result: {} }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
   assert.deepEqual(await snapshot(), before);
   if (withdrawals === 3) {
    const missingEvent = structuredClone(plan.effects);
    delete missingEvent.event;
    await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request: { preview_hash: review.preview_hash }, effects: missingEvent, result: {} }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    const badEvent = structuredClone(plan.effects);
    badEvent.event = { ...badEvent.event, modular_state: 'active' };
    await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request: { preview_hash: review.preview_hash }, effects: badEvent, result: {} }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    const badPlacements = structuredClone(plan.effects);
    const stage = current.stages.find(row => row.module_id === 'placements')!;
    badPlacements.stages!.find(row => row.id === stage.id)!.output = { state: 'completed', groups: [{ rank: 1, entryIds: [randomUUID()] }] };
    await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request: { preview_hash: review.preview_hash }, effects: badPlacements, result: {} }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    assert.deepEqual(await snapshot(), before);
   }
   await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request: { preview_hash: review.preview_hash }, effects: plan.effects, result: plan.result });
   const after = await snapshot();
   assert.ok(after.matches.some(match => match.outcome_kind === 'walkover'));
   if (withdrawals === 3) assert.equal(after.event!.modular_state, 'completed');
  }
 } finally { await db.close(); }
});
