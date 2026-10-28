import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionRef } from './setup-staging.mjs';

export function hostedTarget(projectRef, url) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '') || projectRef === productionRef) throw new Error('STAGING_ONLY');
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== `${projectRef}.supabase.co` || target.username || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) throw new Error('STAGING_ONLY');
  return target.origin;
}

/** Run only after the staging project and exact migrations have been approved and applied. */
export async function hostedConcurrency(projectRef, env = process.env) {
  const url = hostedTarget(projectRef, env.TB_STAGING_SUPABASE_URL);
  if (env.TB_HOSTED_CONCURRENCY_ALLOW !== '1' || !env.TB_STAGING_SUPABASE_SERVICE_ROLE_KEY || !env.TB_STAGING_SUPABASE_ANON_KEY) throw new Error('Explicit staging test opt-in and in-process staging keys required.');
  const { createClient } = await import('@supabase/supabase-js');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, env.TB_STAGING_SUPABASE_SERVICE_ROLE_KEY, options);
  const userClient = createClient(url, env.TB_STAGING_SUPABASE_ANON_KEY, options);
  const run = randomUUID(), email = `tb-race-${run}@example.invalid`, password = `${randomUUID()}${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { given_name: 'Synthetic staging race' } });
  if (created.error || !created.data.user) throw new Error('SYNTHETIC_USER_CREATION_FAILED');
  const actor = created.data.user.id;
  const signedIn = await userClient.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error('SYNTHETIC_USER_SIGNIN_FAILED');
  const event = randomUUID(), operation = randomUUID();
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const actorArgs = { p_actor_id: actor, p_client_id: 'web', p_grant_id: null };
  const create = { ...actorArgs, p_tournament_id: event, p_operation_id: operation, p_request_hash: hash(['createDraft', event]), p_command: 'createDraft', p_expected_revision: null, p_request: {}, p_effects: { event: {} }, p_result: { synthetic_run: run } };
  const denied = await userClient.rpc('tb_apply_command', create);
  assert.ok(denied.error, 'An authenticated browser role must not execute trusted effects.');
  const identical = await Promise.all([service.rpc('tb_apply_command', create), service.rpc('tb_apply_command', create)]);
  assert.ok(identical.every(result => !result.error));
  assert.deepEqual(identical[0].data, identical[1].data, 'Concurrent identical operation IDs must return the same durable receipt.');
  const updates = [0, 1].map(index => ({ ...create, p_operation_id: randomUUID(), p_command: 'updateDraft', p_expected_revision: 1, p_request_hash: hash(['updateDraft', event, index]), p_request: { index }, p_effects: { event: { name: `Synthetic race ${index}` } }, p_result: { index } }));
  const race = await Promise.all(updates.map(input => service.rpc('tb_apply_command', input)));
  assert.equal(race.filter(result => !result.error).length, 1, 'Exactly one same-revision write must commit.');
  assert.ok(race.some(result => result.error?.message.includes('STALE_REVISION')));
  const snapshot = await service.rpc('tb_get_snapshot', { ...actorArgs, p_tournament_id: event });
  assert.equal(snapshot.error, null); assert.equal(Number(snapshot.data.event.revision), 2);
  const cancel = await service.rpc('tb_apply_command', { ...create, p_operation_id: randomUUID(), p_request_hash: hash(['cancelTournament', event]), p_command: 'cancelTournament', p_expected_revision: 2, p_request: { reason: 'Synthetic concurrency test complete' }, p_effects: { event: { modular_state: 'cancelled', cancelled_at: new Date().toISOString() } }, p_result: {} });
  assert.equal(cancel.error, null);
  await userClient.auth.signOut();
  // Keep synthetic rows/receipts for staging audit. Never delete tables, users or unrelated data here.
  return { project_ref: projectRef, synthetic_run: run, tournament_id: event, checks: ['ordinary_role_denied', 'identical_operation_race', 'revision_race', 'snapshot_revision', 'cancelled_with_history'], passed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5 || process.argv[2] !== '--run' || process.argv[3] !== '--project-ref') {
    process.stdout.write('Prepared only; no requests sent. After staging approval: node hosted-concurrency.mjs --run --project-ref <new-ref>\n');
  } else {
    try { process.stdout.write(JSON.stringify(await hostedConcurrency(process.argv[4]), null, 2) + '\n'); }
    catch { process.stderr.write('Hosted staging verification failed; inspect locally without sharing tokens or session data.\n'); process.exitCode = 1; }
  }
}
