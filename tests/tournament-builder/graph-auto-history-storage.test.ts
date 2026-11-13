import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

for (const historicalLoser of [false, true]) test(`automatic terminal graph preserves feeder history; eligible loser=${historicalLoser}`, async () => {
 const db = await storageDatabase();
 try {
  for (const migration of ['202611130003_graph_fixture_ports.sql', '202611130004_graph_seed_pool_review.sql', '202611130005_graph_general_review.sql', '202611130006_graph_partial_auto_group.sql']) await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  const event = randomUUID(), actor = { id: owner, clientId: 'web' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false; d.registration.min_entries = d.registration.max_entries = 4;
  const now = Date.now(); d.event.timezone = 'UTC'; d.registration.closes_at = new Date(now + 30 * 86400000).toISOString(); d.event.starts_at = new Date(now + 31 * 86400000).toISOString(); d.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
  d.nodes = [
   { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
   { id: 'feeder', module: 'match@1', inputs: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }] },
   { id: 'pool', module: 'round_robin@2', inputs: [{ kind: 'winner', node_id: 'feeder' }, ...(historicalLoser ? [] : [{ kind: 'loser' as const, node_id: 'feeder' }]), { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] },
   ...(historicalLoser ? [{ id: 'final', module: 'match@1' as const, inputs: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) }, { id: 'placements', module: 'placements@2' as const, final: 'final' }] : [
    { id: 's1', module: 'match@1' as const, inputs: [1, 4].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) }, { id: 's2', module: 'match@1' as const, inputs: [2, 3].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) },
    { id: 'final', module: 'match@1' as const, inputs: ['s1', 's2'].map(node_id => ({ kind: 'winner' as const, node_id })) }, { id: 'bronze', module: 'match@1' as const, inputs: ['s1', 's2'].map(node_id => ({ kind: 'loser' as const, node_id })) }, { id: 'placements', module: 'placements@2' as const, final: 'final', bronze: 'bronze' },
   ]),
  ];
  const snapshot = async () => role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
  const run = async (name: string, request: Record<string, unknown>, initial?: CommandSnapshot) => { const before = initial ?? await snapshot(), plan = planCommand(before, actor, name, request, context); await command(db, { event, command: name, revision: before.event ? Number(before.event.revision) : null, request, effects: plan.effects, result: plan.result }); return snapshot(); };
  const empty: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  let current = await run('createDraft', { definition: d }, empty); const publication = previewDefinition(d, Number(current.event!.revision)); assert.equal(publication.valid, true);
  current = await run('publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes ?? [] });
  for (let i = 0; i < 4; i++) { const user = randomUUID(); await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [user, `${user}@example.invalid`, JSON.stringify({ given_name: `Player ${i}` })]); current = await run('addRegisteredEntry', { definition_id: current.event!.definition_id, player_ids: [user], entry_name: `Player ${i}`, reason: 'Organizer enrolled verified player.' }); }
  current = await run('closeRegistration', {}); current = await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision }); current = await run('startTournament', {});
  const feeder = current.matches.find(match => match.logical_key === 'feeder:match')!;
  current = await run('attestScore', { match_id: feeder.id, outcome_kind: 'played', score_a: 11, score_b: 3, reason: 'Verified feeder result' });
  const winner = current.matches.find(match => match.id === feeder.id)!.winner_team_id;
  const loser = current.matches.find(match => match.id === feeder.id)!.team_b_id;
  for (const entry_id of current.teams.filter(team => team.id !== winner && (!historicalLoser || team.id !== loser)).map(team => team.id)) { const request = { entry_id, reason: 'Withdrawn before later rounds' }, review = previewWithdrawal(current, actor, request); current = await run('withdrawEntry', { ...request, preview_hash: review.preview_hash }); }
  const review = previewNextStage(current, actor); assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected automatic review');
  const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context), before = await snapshot();
  const invalid = structuredClone(plan.effects), placements = current.stages.find(stage => stage.node_id === 'placements')!;
  invalid.stages!.find(stage => stage.id === placements.id)!.output = { state: 'completed', championEntryId: randomUUID() };
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: invalid, result: plan.result }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
  assert.deepEqual(await snapshot(), before);
  await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
  current = await snapshot(); assert.equal(current.event!.modular_state, 'completed');
  assert.equal((current.stages.find(stage => stage.id === placements.id)!.output as { championEntryId: string }).championEntryId, winner);
  if (historicalLoser) assert.ok((current.stages.find(stage => stage.id === placements.id)!.output as { groups: { entryIds: string[] }[] }).groups.some(group => group.entryIds.includes(String(loser))));
  assert.equal(current.matches.find(match => match.id === feeder.id)!.outcome_kind, 'played');
  current = await run('reopenResults', { reason: 'Review feeder result' });
  const old = current.matches.find(match => match.id === feeder.id)!, proposal = { match_id: old.id, score_a: old.score_b, score_b: old.score_a }, impact = previewCorrection(current, actor, proposal);
  assert.ok(impact.affected_match_ids.length > 0);
  current = await run('commitCorrection', { ...proposal, preview_hash: impact.preview_hash, reason: 'Correct feeder result', resolution: 'void_and_replay' });
  assert.ok(impact.affected_match_ids.every(id => current.matches.find(match => match.id === id)?.is_current === false));
 } finally { await db.close(); }
});
