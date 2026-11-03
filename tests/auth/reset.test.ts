import assert from 'node:assert/strict';
import test, { before, mock } from 'node:test';
import { recoveryGrant } from '../../lib/auth/recovery';

let authenticated = true;
let socialOnly = false;
let grant: string | undefined;
let writes = 0;
let cleared = false;
let signedOut = false;
const secret = 'test-secret';
process.env.SUPABASE_SERVICE_ROLE_KEY = secret;
const fake = { auth: {
  getUser: async () => ({ error: authenticated ? null : { code: 'expired' }, data: { user: authenticated ? { id: 'user', identities: [{ provider: socialOnly ? 'google' : 'email' }] } : null } }),
  getSession: async () => ({ data: { session: { access_token: 'session' } } }),
  updateUser: async () => { writes++; return { error: null }; },
  signOut: async () => { signedOut = true; return { error: null }; },
} };
mock.module('../../lib/supabase/server.ts', { namedExports: { createClient: async () => fake } });
mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => ({ value: grant }), delete: () => { cleared = true; grant = undefined; } }) } });
let update: typeof import('../../app/reset-password/actions')['updateRecoveredPassword'];
before(async () => { update = (await import('../../app/reset-password/actions')).updateRecoveredPassword; });

test('reset rejects missing, forged, expired and wrong-session grants before password mutation', async () => {
  for (const value of [undefined, 'forged', recoveryGrant('user', 'session', secret, Date.now() - 1), recoveryGrant('user', 'other', secret)]) {
    grant = value;
    assert.ok((await update('new-password', 'new-password')).error);
  }
  assert.equal(writes, 0);
});

test('reset independently checks verified user, email identity and password confirmation', async () => {
  grant = recoveryGrant('user', 'session', secret);
  authenticated = false;
  assert.ok((await update('new-password', 'new-password')).error);
  authenticated = true; socialOnly = true;
  assert.ok((await update('new-password', 'new-password')).error);
  socialOnly = false;
  assert.ok((await update('new-password', 'different')).error);
  assert.equal(writes, 0);
});

test('eligible recovery updates existing account, removes grant and signs out; reuse fails', async () => {
  grant = recoveryGrant('user', 'session', secret);
  assert.deepEqual(await update('new-password', 'new-password'), { success: true });
  assert.equal(writes, 1); assert.equal(cleared, true); assert.equal(signedOut, true);
  assert.ok((await update('another-password', 'another-password')).error);
  assert.equal(writes, 1);
});
