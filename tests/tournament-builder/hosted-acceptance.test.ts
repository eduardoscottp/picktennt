import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedAcceptance, readHostedJson, verifyHostedTarget } from '../../scripts/tournament-builder/hosted-acceptance.mjs';
import { productionRef } from '../../scripts/tournament-builder/setup-staging.mjs';

const environment = { NODE_ENV: 'test' as const, NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`, APP_ORIGIN: 'https://app.picktennt.com', TOURNAMENT_BUILDER_ENABLED: 'true', MCP_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'in-process-test-placeholder', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-placeholder' };
test('production acceptance refuses a missing explicit run before network access', async () => {
  await assert.rejects(hostedAcceptance({ projectRef: productionRef }, environment), /EXPLICIT_RUN_REQUIRED/);
});
test('production acceptance target is pinned to the authorized existing project and configured HTTPS app', () => {
  assert.deepEqual(verifyHostedTarget(productionRef, environment), { origin: 'https://app.picktennt.com', supabaseUrl: `https://${productionRef}.supabase.co` });
  assert.throws(() => verifyHostedTarget('a'.repeat(20), environment), /PROJECT_REF_REQUIRED/);
  assert.throws(() => verifyHostedTarget(productionRef, { ...environment, NEXT_PUBLIC_SUPABASE_URL: 'https://anotherproject.supabase.co' }), /TARGET_MISMATCH/);
  assert.throws(() => verifyHostedTarget(productionRef, { ...environment, APP_ORIGIN: 'http://app.picktennt.com' }), /ORIGIN_MISMATCH/);
  assert.throws(() => verifyHostedTarget(productionRef, { ...environment, MCP_ENABLED: 'false' }), /FLAGS_NOT_READY/);
  assert.throws(() => verifyHostedTarget(productionRef, { ...environment, SUPABASE_SERVICE_ROLE_KEY: undefined }), /KEYS_REQUIRED/);
});
test('expected empty MCP unauthorized responses preserve status without inventing JSON', async () => {
  assert.equal(await readHostedJson(new Response(null, { status: 401 })), null);
  assert.deepEqual(await readHostedJson(Response.json({ code: 'FORBIDDEN' }, { status: 403 })), { code: 'FORBIDDEN' });
});
