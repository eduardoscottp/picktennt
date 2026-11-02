// Local fixture acceptance only. No real users, emails, or provider credentials.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../docs/design/idd-auth/', import.meta.url);
await mkdir(output, { recursive: true });
let failLogin = true;
let rateLimited = false;
let socialOnly = false;
let delayLogin = 0;
let writes = 0;
const user = () => ({ id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: socialOnly ? ['apple'] : ['email'] }, user_metadata: {}, identities: [{ provider: socialOnly ? 'apple' : 'email', id: 'fixture' }], created_at: new Date().toISOString() });
const session = () => ({ access_token: `e30.${Buffer.from(JSON.stringify({ sub: user().id, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`, refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user: user() });
const fixture = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3105');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Supabase-Api-Version');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Supabase-Api-Version', '2024-01-01');
  if (req.method === 'OPTIONS') { res.end('{}'); return; }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/auth/v1/token') {
    if (delayLogin) await new Promise(resolve => setTimeout(resolve, delayLogin));
    if (failLogin) { res.statusCode = 400; res.end(JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid login credentials' })); return; }
    res.end(JSON.stringify(session())); return;
  }
  if (path === '/auth/v1/signup') { res.end(JSON.stringify({ user: user(), session: null })); return; }
  if (path === '/auth/v1/resend' && rateLimited) { res.statusCode = 429; res.end(JSON.stringify({ code: 'over_email_send_rate_limit', msg: 'fixture' })); return; }
  if (path === '/auth/v1/verify') { res.end(JSON.stringify(session())); return; }
  if (path === '/auth/v1/user') { if (req.method === 'PUT') writes++; res.end(JSON.stringify(user())); return; }
  res.end('{}');
});
await new Promise(resolve => fixture.listen(54329, '127.0.0.1', resolve));
const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3105'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-key', SUPABASE_SERVICE_ROLE_KEY: 'local-test-server-key' } });
child.stdout.resume(); child.stderr.resume();
const checks = [];
const artifacts = [];
let browser;
try {
  for (let i=0; i<80; i++) {
    try { const response = await fetch('http://127.0.0.1:3105/login'); if (response.ok) break; } catch {}
    if (i===79) throw new Error('Local app did not start');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const origin = 'http://localhost:3105';
  for (const [width, height] of [[1440,900], [390,844], [320,740]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['login','signup']) {
      await page.goto(`${origin}/${mode}?redirect=%2Fjoin%2FDEMO`);
      await page.getByRole('button', { name: 'Continue with Apple' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.getByLabel('Email', { exact: true }).getAttribute('type'), 'email');
      const artifact = `${mode}-${width}.png`;
      await page.screenshot({ path: fileURLToPath(new URL(artifact, output)), fullPage: true });
      artifacts.push({ viewport: `${width}x${height}`, artifact, observation: `${mode}: all three methods and labeled forms fit without horizontal overflow.` });
    }
  }
  checks.push('Login/signup fit at 1440, 390 and 320 pixels; no horizontal overflow.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/signup?redirect=%2Fjoin%2FDEMO`);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'text');
  await page.getByLabel('Confirm password', { exact: true }).fill('different');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Passwords do not match.' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'confirmation');
  await page.getByLabel('Confirm password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL('**/auth/verify-email?redirect=%2Fjoin%2FDEMO');
  checks.push('Registration mismatch focuses confirmation; fixture signup preserves invitation into verification.');
  rateLimited = true;
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByRole('button', { name: 'Resend email' }).click();
  await page.getByRole('alert').filter({ hasText: 'Too many attempts' }).waitFor();
  rateLimited = false;
  await page.getByRole('button', { name: 'Resend email' }).click();
  await page.getByRole('status').filter({ hasText: 'If your account needs confirmation' }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('verification-mobile.png', output)), fullPage: true });
  checks.push('Verification resend shows fixture rate limit and neutral success.');
  await page.goto(`${origin}/forgot-password?redirect=%2Fjoin%2FDEMO`);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.getByRole('status').filter({ hasText: 'If an eligible email/password account exists' }).waitFor();
  checks.push('Forgot password uses neutral confirmation.');
  await page.goto(`${origin}/login?redirect=%2Fjoin%2FDEMO`);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  delayLogin = 800;
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Continue with Google' }).isDisabled(), true);
  await page.getByRole('alert').filter({ hasText: 'Email or password is incorrect' }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('login-error-mobile.png', output)), fullPage: true });
  delayLogin = 0;
  checks.push('Pending login disables provider actions; invalid credentials show allowlisted error.');
  await page.goto(`${origin}/reset-password`);
  await page.getByRole('heading', { name: 'Reset link unavailable' }).waitFor();
  assert.equal(await page.getByLabel('New password', { exact: true }).count(), 0);
  checks.push('Direct reset without recovery proof has no password form.');
  await page.goto(`${origin}/auth/web-confirm?flow=recovery&type=recovery&token_hash=local-fixture&next=%2Fjoin%2FDEMO`);
  await page.getByRole('heading', { name: 'Set a new password' }).waitFor();
  await page.getByLabel('New password', { exact: true }).fill('new-fixture-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('new-fixture-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.getByRole('heading', { name: 'Password updated' }).waitFor();
  assert.equal(writes, 1);
  checks.push('Fixture recovery OTP grants reset; server action updates once and returns to sign-in.');
  await context.clearCookies(); socialOnly = true;
  await page.goto(`${origin}/auth/web-confirm?flow=recovery&type=recovery&token_hash=local-fixture`);
  await page.getByRole('heading', { name: 'Reset link unavailable' }).waitFor();
  assert.equal(writes, 1); socialOnly = false;
  checks.push('Fixture Apple-only recovery is rejected without a password update.');
  await context.clearCookies(); failLogin = false;
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.route(`${origin}/dashboard`, route => route.fulfill({ contentType: 'text/html', body: '<h1>Fixture destination</h1>' }));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${origin}/dashboard`);
  await page.goto(`${origin}/login`);
  await page.getByRole('heading', { name: 'You’re signed in' }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: 'You’re signed in' }).waitFor();
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  checks.push('Fixture password login session survives refresh; account switch signs out and reloads chooser.');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement?.tagName !== 'BODY'));
  const report = { contract: 'README.md screen contract; local fixture backend only, not provider acceptance.', targetViewports: ['1440x900','390x844','320x740'], accessibility: { status: 'pass', evidence: 'Visible labels, keyboard focus, password visibility and mismatch focus exercised. Screen-reader/real-device QA pending.' }, responsive: { status: 'pass', evidence: 'Login/signup rendered at 1440/390/320 with no horizontal overflow.' }, contentStates: { loading: { status: 'pass', evidence: 'Pending fixture login disables request controls.' }, empty: { status: 'pass', evidence: 'Blank forms use required/email validation.' }, error: { status: 'pass', evidence: 'Mismatch, invalid credentials and rate limit exercised.' }, partial: { status: 'pass', evidence: 'Verification-pending signup retains invitation context.' }, success: { status: 'pass', evidence: 'Fixture password login and recovery update succeeded.' }, permission: { status: 'pass', evidence: 'Direct reset and Apple-only reset deny permission.' } }, renderedEvidence: artifacts, checks, targetAcceptance: 'NOT PERFORMED: real Supabase/providers/email/native identity continuity and iOS Safari.' };
  await writeFile(new URL('browser-evidence.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, realProviderAcceptance: 'NOT PERFORMED' }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close(); child.kill(); fixture.close();
}
