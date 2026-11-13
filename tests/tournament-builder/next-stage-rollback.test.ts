import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';

test('local rollback restores command boundary and preserves tournament data', async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130004_graph_seed_pool_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130005_graph_general_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130006_graph_partial_auto_group.sql', 'utf8'));
    const event = randomUUID(), definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
    const empty: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
    const plan = planCommand(empty, { id: owner, clientId: 'web', role: 'owner' }, 'createDraft', { definition }, { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: ids => [...ids] });
    await command(db, { event, command: 'createDraft', revision: null, request: { definition }, effects: plan.effects, result: plan.result });
    const data = async () => (await db.query('SELECT to_jsonb(t) AS tournament FROM tournaments t WHERE id=$1', [event])).rows;
    const before = await data(); assert.equal(before.length, 1);
    await db.exec(readFileSync('scripts/rollback-reviewed-next-stage.sql', 'utf8'));
    assert.deepEqual(await data(), before);
    const source = (await db.query<{ apply: string; auth: string }>(`SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) AS apply, pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) AS auth`)).rows[0];
    assert.doesNotMatch(source.apply, /generateNextStage|validate_next_stage|validate_graph_next_stage/);
    assert.doesNotMatch(source.auth, /generateNextStage/);
    const helpers = await db.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='tournament_builder_private' AND proname IN ('validate_next_stage','validate_graph_next_stage','graph_seed','graph_fixture_ports','graph_resolve_bindings','validate_graph_scheduled_fixtures','validate_graph_empty_group','validate_graph_seed_pool','graph_node_inputs','validate_graph_initial_node','validate_graph_general_no_auto','graph_resolve_auto_group_bindings','validate_graph_partial_auto_group','graph_effective_bindings','validate_graph_auto_match','validate_graph_routes')`);
    assert.equal(helpers.rows.length, 0);
  } finally { await db.close(); }
});

test('rollback aborts atomically when the live authorization source has diverged', async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130004_graph_seed_pool_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130005_graph_general_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130006_graph_partial_auto_group.sql', 'utf8'));
    const getApply = async () => (await db.query<{ definition: string }>("SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) AS definition")).rows[0].definition;
    const original = await getApply();
    const auth = (await db.query<{ definition: string }>("SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) AS definition")).rows[0].definition;
    await db.exec(auth.replace("ARRAY['generateNextStage','appendTerminalMatch','replayTerminalMatch'", "ARRAY['appendTerminalMatch','replayTerminalMatch'"));
    await assert.rejects(db.exec(readFileSync('scripts/rollback-reviewed-next-stage.sql', 'utf8')), /ROLLBACK_AUTH_SOURCE_MISMATCH/);
    await db.exec('ROLLBACK');
    assert.equal(await getApply(), original);
    assert.equal((await db.query<{ present: boolean }>("SELECT to_regprocedure('tournament_builder_private.validate_next_stage(uuid,uuid,jsonb,jsonb)') IS NOT NULL AS present")).rows[0].present, true);
  } finally { await db.close(); }
});
