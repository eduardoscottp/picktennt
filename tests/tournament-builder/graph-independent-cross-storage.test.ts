import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import { planGraphRuntime } from '../../lib/tournament-builder/graph-command-runtime';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

test('independent cross-play must be validated before creating a separate match branch', async () => {
 const db = await storageDatabase();
 try {
  for (const migration of ['202611130003_graph_fixture_ports.sql', '202611130004_graph_seed_pool_review.sql', '202611130005_graph_general_review.sql', '202611130006_graph_partial_auto_group.sql']) await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  const event = randomUUID(), actor = { id: owner, clientId: 'web' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false; d.registration.min_entries = d.registration.max_entries = 6;
  const now = Date.now(); d.event.timezone = 'UTC'; d.registration.closes_at = new Date(now + 30 * 86400000).toISOString(); d.event.starts_at = new Date(now + 31 * 86400000).toISOString(); d.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
  d.nodes = [
   { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
   { id: 'independent', module: 'cross_play@1', side_a: [1, 2].map(seed => ({ kind: 'seed', seed })), side_b: [3, 4].map(seed => ({ kind: 'seed', seed })) },
   { id: 'qualifier', module: 'match@1', inputs: [5, 6].map(seed => ({ kind: 'seed', seed })) },
   { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'qualifier' }, { kind: 'loser', node_id: 'qualifier' }] },
   { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  const snapshot = async () => role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
  const run = async (name: string, request: Record<string, unknown>, initial?: CommandSnapshot) => { const before = initial ?? await snapshot(), plan = planCommand(before, actor, name, request, context); await command(db, { event, command: name, revision: before.event ? Number(before.event.revision) : null, request, effects: plan.effects, result: plan.result }); return snapshot(); };
  const empty: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  let current = await run('createDraft', { definition: d }, empty); const publication = previewDefinition(d, Number(current.event!.revision)); assert.equal(publication.valid, true);
  current = await run('publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes ?? [] });
  for (let i = 0; i < 6; i++) { const user = randomUUID(); await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [user, `${user}@example.invalid`, JSON.stringify({ given_name: `Player ${i}` })]); current = await run('addRegisteredEntry', { definition_id: current.event!.definition_id, player_ids: [user], entry_name: `Player ${i}`, reason: 'Organizer enrolled verified player.' }); }
  current = await run('closeRegistration', {}); current = await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision }); current = await run('startTournament', {});
  assert.equal(current.matches.length, 5);
  const cross = current.stages.find(stage => stage.node_id === 'independent')!, qualifier = current.matches.find(match => match.logical_key === 'qualifier:match')!;
  current = await run('attestScore', { match_id: qualifier.id, outcome_kind: 'played', score_a: 11, score_b: 3, reason: 'Verified source' });
  const incomplete = previewNextStage(current, actor);
  assert.equal(incomplete.state, 'blocked');
  if (incomplete.state !== 'blocked') throw new Error('Expected validation requirement');
  assert.equal(incomplete.reason, 'RESULTS_INCOMPLETE'); assert.equal(incomplete.pending_results, 4);
  const copy = structuredClone(current), roster = copy.stages.find(stage => stage.module_id === 'entries')!;
  roster.output = { ...(roster.output as object), graphNextStageApproved: true };
  const bypass = planGraphRuntime(copy, d, actor, context, Number(current.event!.revision) + 1, new Set(), new Set(['final:match']));
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request: { preview_hash: 'a'.repeat(64) }, effects: bypass.effects, result: bypass.result }), /INVALID_STATE|INVALID_EFFECTS/);
  for (const match of current.matches.filter(row => row.stage_id === cross.id)) current = await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: 11, score_b: 3, reason: 'Verified independent result' });
  const before = await snapshot(), review = previewNextStage(current, actor);
  assert.equal(review.state, 'ready'); if (review.state !== 'ready') throw new Error('Expected independent review');
  const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
  const forged = structuredClone(plan.effects); forged.matches!.find(match => match.logical_key === 'final:match')!.team_a_id = randomUUID();
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forged, result: plan.result }), /INVALID_EFFECTS|INVALID_STATE/);
  assert.deepEqual(await snapshot(), before);
  current = await run('generateNextStage', request);
  assert.equal(current.matches.filter(match => match.stage_id === cross.id && match.status === 'validated').length, 4);
  assert.ok(current.matches.some(match => match.logical_key === 'final:match'));
 } finally { await db.close(); }
});
