import assert from 'node:assert/strict';
import test, { mock, before } from 'node:test';
import { NextRequest } from 'next/server';
import { RECOVERY_COOKIE, validRecoveryGrant } from '../../lib/auth/recovery';

let providerError = false;
let providers = ['email'];
let verifies = 0;
let signouts = 0;
let profileOptions: unknown;
let cookies: ((values: { name: string; value: string; options: object }[]) => void) | undefined;
const fake = {
  auth: {
    verifyOtp: async () => { verifies++; cookies?.([{ name: 'test-session', value: 'fixture', options: {} }]); return { error: providerError ? { code: 'otp_expired' } : null, data: { user: { id: 'user', identities: providers.map(provider => ({ provider })) }, session: { access_token: 'session' } } }; },
    exchangeCodeForSession: async () => ({ error: providerError ? { code: 'bad_code' } : null, data: { user: { id: 'user', user_metadata: {} } } }),
    signOut: async () => { signouts++; return { error: null }; },
  },
  from: () => ({
    upsert: async (_data: unknown, options: unknown) => { profileOptions = options; return { error: null }; },
    select: () => ({ eq: () => ({ single: async () => ({ data: { dupr_id: 'existing' } }) }) }),
  }),
};
mock.module('@supabase/ssr', { namedExports: { createServerClient: (_url: string, _key: string, options: { cookies: { setAll: typeof cookies } }) => { cookies = options.cookies.setAll; return fake; } } });
let confirm: typeof import('../../app/auth/web-confirm/route')['GET'];
let callback: typeof import('../../app/auth/callback/route')['GET'];
before(async () => {
  confirm = (await import('../../app/auth/web-confirm/route')).GET;
  callback = (await import('../../app/auth/callback/route')).GET;
});
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';

test('recovery rejects missing/wrong token type without contacting provider', async () => {
  const before = verifies;
  for (const query of ['flow=recovery', 'flow=recovery&type=email&token_hash=fixture', 'flow=signup&type=recovery&token_hash=fixture']) {
    const result = await confirm(new NextRequest(`https://app.picktennt.test/auth/web-confirm?${query}`));
    assert.match(result.headers.get('location')!, /error=link_unavailable/);
    assert.equal(result.cookies.get(RECOVERY_COOKIE)?.value ?? '', '');
  }
  assert.equal(verifies, before);
});

test('valid recovery creates a session-bound HttpOnly grant and strips token from destination', async () => {
  providers = ['email']; providerError = false;
  const result = await confirm(new NextRequest('https://app.picktennt.test/auth/web-confirm?flow=recovery&type=recovery&token_hash=fixture&next=%2Fjoin%2FABC'));
  assert.equal(result.headers.get('location'), 'https://app.picktennt.test/reset-password?redirect=%2Fjoin%2FABC');
  const cookie = result.cookies.get(RECOVERY_COOKIE)!;
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true);
  assert.equal(validRecoveryGrant(cookie.value, 'user', 'session', 'test-secret'), true);
  assert.equal(result.cookies.get('test-session')?.value, 'fixture');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
});

test('expired tokens and social-only users cannot obtain password-reset permission', async () => {
  for (const expired of [true, false]) {
    providerError = expired; providers = ['apple'];
    const result = await confirm(new NextRequest('https://app.picktennt.test/auth/web-confirm?flow=recovery&type=recovery&token_hash=fixture'));
    assert.match(result.headers.get('location')!, /error=link_unavailable/);
    assert.equal(result.cookies.get(RECOVERY_COOKIE)?.value ?? '', '');
  }
  assert.ok(signouts > 0);
});

test('signup confirmation retains session cookies and safe invitation context without a recovery grant', async () => {
  providers = ['email']; providerError = false;
  const result = await confirm(new NextRequest('https://app.picktennt.test/auth/web-confirm?flow=signup&type=email&token_hash=fixture&next=%2Fjoin%2FABC'));
  assert.equal(result.headers.get('location'), 'https://app.picktennt.test/join/ABC');
  assert.equal(result.cookies.get('test-session')?.value, 'fixture');
  assert.equal(result.cookies.get(RECOVERY_COOKIE), undefined);
});

test('OAuth failures preserve the requested destination and returning profiles are insert-only', async () => {
  providerError = true;
  const failed = await callback(new NextRequest('https://app.picktennt.test/auth/callback?code=fixture&next=%2Fjoin%2FABC'));
  assert.equal(new URL(failed.headers.get('location')!).searchParams.get('redirect'), '/join/ABC');
  providerError = false;
  const result = await callback(new NextRequest('https://app.picktennt.test/auth/callback?code=fixture&next=%2Ftournaments'));
  assert.equal(result.headers.get('location'), 'https://app.picktennt.test/tournaments');
  assert.deepEqual(profileOptions, { onConflict: 'id', ignoreDuplicates: true });
});
