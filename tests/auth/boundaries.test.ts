import assert from 'node:assert/strict';
import test from 'node:test';
import { safeReturnPath, authPath } from '../../lib/auth/return-path';
import { recoveryGrant, validRecoveryGrant, hasEmailIdentity, RECOVERY_SECONDS } from '../../lib/auth/recovery';
import { authError } from '../../lib/auth/errors';

test('keeps supported app destinations and invitation query context', () => {
  for (const path of ['/dashboard', '/profile', '/setup', '/join/ABC123', '/s/ABC123', '/tournaments/123/matches?round=2', '/oauth/authorize?client_id=example&state=opaque']) assert.equal(safeReturnPath(path), path);
  assert.equal(authPath('/signup', '/join/ABC123'), '/signup?redirect=%2Fjoin%2FABC123');
});

test('rejects external URLs, browser normalization tricks, tokens and authentication loops', () => {
  for (const path of [null, '', 'https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/%5cevil.invalid', '/%2fevil.invalid', '/%0aevil', '/login', '/signup', '/auth/callback', '/reset-password', '/tournaments/../auth/callback', '/dashboardx', '/api/account/delete', '/dashboard?access_token=secret', '/profile?password=secret', '/join/%', '/s/ABC\n', ' /dashboard']) assert.equal(safeReturnPath(path), '/dashboard', String(path));
});

test('recovery requires a signed unexpired grant for the exact verified user and session', () => {
  const now = Date.now();
  const grant = recoveryGrant('user', 'session', 'test-secret', now + 10000);
  assert.equal(validRecoveryGrant(grant, 'user', 'session', 'test-secret', now), true);
  for (const [user, session, secret] of [['other', 'session', 'test-secret'], ['user', 'other', 'test-secret'], ['user', 'session', 'other']]) assert.equal(validRecoveryGrant(grant, user, session, secret, now), false);
  for (const invalid of [undefined, '', `${grant}x`, 'NaN.signature', recoveryGrant('user', 'session', 'test-secret', now - 1), recoveryGrant('user', 'session', 'test-secret', now + RECOVERY_SECONDS * 1000 + 1)]) assert.equal(validRecoveryGrant(invalid, 'user', 'session', 'test-secret', now), false);
});

test('social-only and missing identities are ineligible for web password recovery', () => {
  assert.equal(hasEmailIdentity({}), false);
  assert.equal(hasEmailIdentity({ identities: [{ provider: 'google' }, { provider: 'apple' }] }), false);
  assert.equal(hasEmailIdentity({ identities: [{ provider: 'email' }, { provider: 'google' }] }), true);
});

test('backend errors become useful allowlisted copy rather than provider details', () => {
  assert.match(authError({ code: 'invalid_credentials' }), /incorrect/);
  assert.match(authError({ code: 'email_not_confirmed' }), /Confirm/);
  assert.match(authError({ code: 'weak_password' }), /stronger/);
  assert.match(authError({ status: 429 }), /wait/);
  assert.equal(authError({ code: 'internal_secret_or_email_exists' }), authError(null));
});
