import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

for (const mode of ['initial_match', 'group_seeds', 'match_only', 'match_only_three', 'initial_cross'] as const) test(`real empty ${mode} is independently audited`, async () => {
 const emptyInput = mode === 'group_seeds', matchOnly = mode === 'match_only' || mode === 'match_only_three' || mode === 'initial_cross', three = mode === 'match_only_three';
 const db = await storageDatabase();
 try {
  for (const migration of ['202611130003_graph_fixture_ports.sql', '202611130004_graph_seed_pool_review.sql', '202611130005_graph_general_review.sql', '202611130006_graph_partial_auto_group.sql']) await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  const event = randomUUID(), actor = { id: owner, clientId: 'web' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false; d.registration.min_entries = three ? 3 : 2; d.registration.max_entries = three ? 5 : 4;
  const now = Date.now(); d.event.timezone = 'UTC'; d.registration.closes_at = new Date(now + 30 * 86400000).toISOString(); d.event.starts_at = new Date(now + 31 * 86400000).toISOString(); d.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
  d.nodes = [
   { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
   { id: 'source', module: 'round_robin@2', inputs: (three ? [1, 2, 3] : [1, 2]).map(seed => ({ kind: 'seed', seed })) },
   ...(emptyInput ? [] : mode === 'initial_cross' ? [{ id: 'empty', module: 'cross_play@1' as const, side_a: [{ kind: 'seed' as const, seed: 3 }], side_b: [{ kind: 'seed' as const, seed: 4 }] }] : [{ id: 'empty', module: 'match@1' as const, inputs: (three ? [4, 5] : [3, 4]).map(seed => ({ kind: 'seed' as const, seed })) }]),
   ...(matchOnly ? [] : [{ id: 'pool', module: 'round_robin@2' as const, inputs: emptyInput ? [{ kind: 'rank' as const, node_id: 'source', rank: 1 }, { kind: 'rank' as const, node_id: 'source', rank: 2 }, { kind: 'seed' as const, seed: 3 }, { kind: 'seed' as const, seed: 4 }] : [{ kind: 'rank' as const, node_id: 'source', rank: 1 }, { kind: 'winner' as const, node_id: 'empty' }] }]),
   { id: 'final', module: 'match@1', inputs: matchOnly ? [{ kind: 'rank', node_id: 'source', rank: 1 }, mode === 'initial_cross' ? { kind: 'rank', node_id: 'empty', rank: 1 } : { kind: 'winner', node_id: 'empty' }] : [1, 2].map(rank => ({ kind: 'rank', node_id: 'pool', rank })) },
   { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  const snapshot = async () => role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
  const run = async (name: string, request: Record<string, unknown>, initial?: CommandSnapshot) => { const before = initial ?? await snapshot(), plan = planCommand(before, actor, name, request, context); await command(db, { event, command: name, revision: before.event ? Number(before.event.revision) : null, request, effects: plan.effects, result: plan.result }); return snapshot(); };
  const empty: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  let current = await run('createDraft', { definition: d }, empty); const publication = previewDefinition(d, Number(current.event!.revision)); assert.equal(publication.valid, true);
  current = await run('publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes ?? [] });
  for (let i = 0; i < (three ? 3 : 2); i++) { const user = randomUUID(); await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [user, `${user}@example.invalid`, JSON.stringify({ given_name: `Player ${i}` })]); current = await run('addRegisteredEntry', { definition_id: current.event!.definition_id, player_ids: [user], entry_name: `Player ${i}`, reason: 'Organizer enrolled verified player.' }); }
  current = await run('closeRegistration', {}); current = await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision, group_assignments: { source: current.teams.map(team => team.id) } }); current = await run('startTournament', {});
  const emptyMatch = current.matches.find(match => match.logical_key === (mode === 'initial_cross' ? 'empty:r1:m1' : 'empty:match'));
  if (!emptyInput) { assert.equal(emptyMatch!.outcome_kind, 'no_contest'); assert.equal(emptyMatch!.winner_team_id, null); }
  for (const source of current.matches.filter(match => String(match.logical_key).startsWith('source:'))) {
   const a = Number(current.teams.find(team => team.id === source.team_a_id)!.seed), b = Number(current.teams.find(team => team.id === source.team_b_id)!.seed);
   current = await run('attestScore', { match_id: source.id, outcome_kind: 'played', score_a: a < b ? 11 : a + b, score_b: a < b ? a + b : 11, reason: 'Verified source result' });
  }
  const review = previewNextStage(current, actor); assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected reviewed vacant routes');
  const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
  const validate = (effects: unknown) => db.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify(request), JSON.stringify(effects)]);
  await validate(plan.effects);
  const forged = structuredClone(plan.effects);
  if (emptyInput) forged.matches!.find(match => match.logical_key === 'pool:r1:m1')!.team_a_id = randomUUID();
  else forged.matches!.find(match => match.outcome_kind === 'walkover')!.winner_team_id = randomUUID();
  await assert.rejects(validate(forged), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
  if (emptyMatch) {
   for (const [field, value] of [['status', 'scheduled'], ['outcome_kind', 'played'], ['winner_team_id', current.teams[0].id]] as const) {
    await assert.rejects(db.transaction(async tx => {
     await tx.query('INSERT INTO tournament_builder_private.command_context(transaction_id,event_id) VALUES(txid_current(),$1)', [event]);
     await tx.query(`UPDATE public.matches SET ${field}=$1 WHERE id=$2`, [value, emptyMatch.id]);
     await tx.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify(request), JSON.stringify(plan.effects)]);
    }), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT|violates check constraint/);
   }
  }
  await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
  assert.equal((await snapshot()).event!.modular_state, emptyInput ? 'active' : 'completed');
 } finally { await db.close(); }
});
