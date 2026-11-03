import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { productionRef } from './setup-staging.mjs';

const PURPOSE = 'tournament-builder-hosted-acceptance';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = code => { throw new Error(code); };
const check = (condition, code) => { if (!condition) fail(code); };

/** Ref/origin checks run before any network access or synthetic-user creation. */
export function verifyHostedTarget(projectRef, env) {
  check(projectRef === productionRef, 'EXPLICIT_PRODUCTION_PROJECT_REF_REQUIRED');
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://invalid.example');
  check(url.origin === `https://${productionRef}.supabase.co` && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'SUPABASE_TARGET_MISMATCH');
  const origin = new URL(env.APP_ORIGIN ?? 'https://invalid.example');
  check(origin.protocol === 'https:' && origin.origin === env.APP_ORIGIN && !origin.username && !origin.password, 'APP_ORIGIN_MISMATCH');
  check(env.TOURNAMENT_BUILDER_ENABLED === 'true' && env.MCP_ENABLED === 'true', 'DEPLOYMENT_FLAGS_NOT_READY');
  check(Boolean(env.SUPABASE_SERVICE_ROLE_KEY && env.NEXT_PUBLIC_SUPABASE_ANON_KEY), 'IN_PROCESS_PRODUCTION_KEYS_REQUIRED');
  return { origin: origin.origin, supabaseUrl: url.origin };
}

/** Existing authenticated Supabase management session; capture stdout only in memory, never reveal keys. */
export function managementEnvironment(projectRef, origin = 'https://app.picktennt.com') {
  check(projectRef === productionRef && origin === 'https://app.picktennt.com', 'EXPLICIT_PRODUCTION_PROJECT_REF_REQUIRED');
  let keys;
  try {
    const raw = process.platform === 'win32'
      ? execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase projects api-keys --project-ref ${productionRef} --output json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 1048576 })
      : execFileSync('npx', ['--yes', 'supabase', 'projects', 'api-keys', '--project-ref', productionRef, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1048576 });
    const parsed = JSON.parse(raw); keys = Array.isArray(parsed) ? parsed : parsed.api_keys ?? parsed.data;
  } catch { fail('MANAGEMENT_KEY_LOOKUP_FAILED'); }
  const anon = keys?.find(key => key.name === 'anon' && key.type === 'legacy')?.api_key;
  const service = keys?.find(key => key.name === 'service_role' && key.type === 'legacy')?.api_key;
  check(typeof anon === 'string' && typeof service === 'string', 'EXISTING_PROJECT_KEYS_UNAVAILABLE');
  return { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service, APP_ORIGIN: origin, TOURNAMENT_BUILDER_ENABLED: 'true', MCP_ENABLED: 'true' };
}

function hidden(html, name) {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  check(Boolean(value), 'EXPECTED_NATIVE_CONSENT_FORM'); return value;
}
function absorb(jar, response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0], index = pair.indexOf('=');
    const name = pair.slice(0, index), value = pair.slice(index + 1);
    if (!value || /max-age=0(?:;|$)/i.test(cookie)) jar.delete(name); else jar.set(name, value);
  }
}
const safeCode = body => typeof body?.code === 'string' && /^[A-Z_]+$/.test(body.code) ? body.code : 'HTTP_REQUEST_FAILED';
export async function readHostedJson(response) { const body = await response.text(); return body ? JSON.parse(body) : null; }

/** No credentials/session material is written or returned. Only labeled synthetic identities may be changed.
 * Cleanup preserves every tournament, profile and receipt; own synthetic sessions are signed out and accounts
 * are banned after verifying their matching run marker. Resume resets only those same marked identities.
 * This proves hosted protocol behavior, not an actual ChatGPT/Claude account connection journey.
 */
export async function hostedAcceptance(options, env = process.env) {
  check(options?.run === true, 'EXPLICIT_RUN_REQUIRED');
  const target = verifyHostedTarget(options.projectRef, env);
  const { createClient } = await import('@supabase/supabase-js');
  const { createServerClient } = await import('@supabase/ssr');
  const service = createClient(target.supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = options.resumeRun ?? randomUUID();
  check(uuid.test(run), 'INVALID_RUN_MARKER');
  const accountIds = options.accountIds ?? [];
  check(options.resumeRun ? accountIds.length === 4 && new Set(accountIds).size === 4 && accountIds.every(id => uuid.test(id)) : accountIds.length === 0, 'RESUME_REQUIRES_FOUR_OWN_ACCOUNT_IDS');
  const report = { project_ref: options.projectRef, origin: target.origin, synthetic_run: run, passed: false, checks: [], accounts: [], tournaments: [], placements: [], cleanup: {}, actual_chatgpt_or_claude_journey: false };
  const clients = [];
  let lastStep = 'preflight', activeGrant = false;
  const mark = value => { report.checks.push(value); lastStep = value; };
  async function request(path, init = {}, client) {
    const url = new URL(path, target.origin);
    check(url.origin === target.origin, 'CROSS_ORIGIN_REQUEST_BLOCKED');
    const headers = new Headers(init.headers);
    if (client) headers.set('cookie', [...client.jar].map(([name, value]) => `${name}=${value}`).join('; '));
    if (init.method && init.method !== 'GET') headers.set('origin', target.origin);
    const response = await fetch(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (client) absorb(client.jar, response);
    return response;
  }
  async function json(path, init = {}, client) {
    const response = await request(path, init, client);
    let body; try { body = await readHostedJson(response); } catch { fail('EXPECTED_JSON_RESPONSE'); }
    return { response, body };
  }
  const post = (path, body, client) => json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, client);
  async function snapshot(id, client = clients[0]) {
    const answer = await json(`/api/tournament-builder/${id}`, {}, client);
    check(answer.response.ok, safeCode(answer.body)); return answer.body;
  }
  async function command(id, name, data, client = clients[0], supplied) {
    const envelope = supplied ?? { operation_id: randomUUID(), expected_revision: Number((await snapshot(id, clients[0])).snapshot.event.revision), data };
    const path = `/api/tournament-builder/${id}/commands?command=${name}`;
    try {
      const answer = await post(path, envelope, client);
      check(answer.response.ok, safeCode(answer.body)); return { receipt: answer.body, envelope };
    } catch (error) {
      // An ambiguous response is resolved through the original receipt before any retry.
      if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) throw error;
      const lookup = await json(`/api/tournament-builder/${id}/commands?operation_id=${envelope.operation_id}`, {}, client);
      if (lookup.response.ok && lookup.body) return { receipt: lookup.body, envelope };
      const retry = await post(path, envelope, client);
      check(retry.response.ok, safeCode(retry.body)); return { receipt: retry.body, envelope };
    }
  }
  async function revokeNativeGrant() {
    const page = await request('/oauth/connections', {}, clients[0]);
    check(page.status === 200, 'NATIVE_CONNECTIONS_UNAVAILABLE');
    const html = await page.text(), csrf = hidden(html, 'csrf'), grantId = hidden(html, 'grant_id');
    const response = await request('/oauth/connections', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_id: grantId, csrf }) }, clients[0]);
    check(response.status === 303, 'NATIVE_GRANT_REVOCATION_FAILED'); activeGrant = false;
  }
  try {
    const metadata = await json('/.well-known/oauth-authorization-server');
    check(metadata.response.ok && metadata.body.issuer === target.origin, 'OAUTH_DISCOVERY_NOT_DEPLOYED');
    for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) check(new URL(metadata.body[field]).origin === target.origin, 'OAUTH_DISCOVERY_ORIGIN_MISMATCH');
    const missing = await request('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    check(missing.status === 401 && missing.headers.get('www-authenticate')?.includes('resource_metadata'), 'MCP_AUTH_CHALLENGE_MISSING');
    mark('hosted_discovery_and_auth_challenge');

    for (let index = 0; index < 4; index++) {
      lastStep = `synthetic_account_${index + 1}`;
      const label = String.fromCharCode(65 + index), password = `${randomBytes(32).toString('base64url')}Aa1!`;
      let user;
      if (options.resumeRun) {
        const found = await service.auth.admin.getUserById(accountIds[index]);
        check(!found.error && found.data.user?.user_metadata?.tb_synthetic_run === run && found.data.user.user_metadata.tb_synthetic_purpose === PURPOSE, 'RESUME_ACCOUNT_MARKER_MISMATCH');
        const updated = await service.auth.admin.updateUserById(accountIds[index], { password, ban_duration: 'none', email_confirm: true });
        check(!updated.error && updated.data.user, 'SYNTHETIC_ACCOUNT_RESUME_FAILED'); user = updated.data.user;
      } else {
        const created = await service.auth.admin.createUser({ email: `tb-accept-${run}-${label.toLowerCase()}@example.invalid`, password, email_confirm: true, user_metadata: { given_name: `Synthetic Acceptance ${label}`, family_name: run.slice(0, 8), tb_synthetic_run: run, tb_synthetic_purpose: PURPOSE } });
        if (created.error) {
          report.auth_error_code = typeof created.error.code === 'string' && /^[a-z0-9_]{1,80}$/.test(created.error.code) ? created.error.code : 'unclassified';
          report.auth_http_status = created.error.status;
          report.auth_failure_category = /password/i.test(created.error.message) ? 'synthetic_password_validation' : /email.*invalid|invalid.*email/i.test(created.error.message) ? 'invalid_synthetic_email' : /database/i.test(created.error.message) ? 'auth_database_failure' : /not allowed|not authorized|invalid.*jwt/i.test(created.error.message) ? 'auth_admin_permission' : 'other_auth_failure';
        }
        check(!created.error && created.data.user, 'SYNTHETIC_ACCOUNT_CREATION_FAILED'); user = created.data.user;
      }
      report.accounts.push({ id: user.id, label, marker: PURPOSE });
      const jar = new Map();
      const sdk = createServerClient(target.supabaseUrl, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, detectSessionInUrl: false }, cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cookies => cookies.forEach(cookie => cookie.value ? jar.set(cookie.name, cookie.value) : jar.delete(cookie.name)) } });
      const signed = await sdk.auth.signInWithPassword({ email: user.email, password });
      check(!signed.error && signed.data.user?.id === user.id, 'SYNTHETIC_NATIVE_SIGNIN_FAILED');
      clients.push({ id: user.id, label, sdk, jar });
    }
    mark('four_new_synthetic_native_sessions');
    const fixture = JSON.parse(readFileSync(new URL('../../tests/tournament-builder/fixtures/tournament-definition.json', import.meta.url), 'utf8'));
    const at = Date.now() + 7 * 86400000;
    fixture.event = { ...fixture.event, name: `[SYNTHETIC ACCEPTANCE ${run.slice(0, 8)}] RR4 bronze`, starts_at: new Date(at).toISOString(), expected_end_at: new Date(at + 4 * 3600000).toISOString(), timezone: 'Etc/UTC', venue_name: 'Synthetic acceptance only - no real booking', courts: 2, visibility: 'unlisted' };
    fixture.registration = { ...fixture.registration, mode: 'open', entry_type: 'singles', partner_consent: false, min_entries: 4, max_entries: 4, closes_at: new Date(at - 86400000).toISOString(), organizer_plays: true };
    fixture.scheduling.minimum_rest_minutes = 0;
    fixture.nodes.find(node => node.module === 'elimination@1').config.bronze = true;

    const registration = await post('/oauth/register', { client_name: `Synthetic acceptance ${run.slice(0, 8)}`, redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'tournaments:draft' });
    check(registration.response.status === 201 && typeof registration.body.client_id === 'string', 'DYNAMIC_CLIENT_REGISTRATION_FAILED');
    const clientId = registration.body.client_id, verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
    const authorize = new URL('/oauth/authorize', target.origin);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: `${target.origin}/api/mcp`, scope: 'tournaments:draft', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    const consentPage = await request(authorize, {}, clients[0]);
    check(consentPage.status === 200, 'NATIVE_OAUTH_CONSENT_UNAVAILABLE');
    const consentHtml = await consentPage.text();
    const consentResponse = await request('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: hidden(consentHtml, 'request_id'), csrf: hidden(consentHtml, 'csrf'), action: 'approve' }) }, clients[0]);
    check(consentResponse.status === 303, 'NATIVE_OAUTH_CONSENT_FAILED'); activeGrant = true;
    const callback = new URL(consentResponse.headers.get('location'));
    check(callback.origin === 'https://claude.ai' && callback.pathname === '/api/mcp/auth_callback' && callback.searchParams.get('state') === state && callback.searchParams.get('iss') === target.origin, 'OAUTH_CALLBACK_BINDING_FAILED');
    const tokenInput = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: `${target.origin}/api/mcp`, code: callback.searchParams.get('code'), code_verifier: verifier };
    const tokenResponse = await json('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenInput) });
    check(tokenResponse.response.ok && typeof tokenResponse.body.access_token === 'string' && typeof tokenResponse.body.refresh_token === 'string', 'PKCE_CODE_EXCHANGE_FAILED');
    const replayCode = await json('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenInput) });
    check(replayCode.response.status === 400 && replayCode.body.error === 'invalid_grant', 'AUTHORIZATION_CODE_REPLAY_NOT_REJECTED');
    const rotated = await json('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokenResponse.body.refresh_token, resource: `${target.origin}/api/mcp` }) });
    check(rotated.response.ok && typeof rotated.body.access_token === 'string' && typeof rotated.body.refresh_token === 'string', 'OPAQUE_REFRESH_ROTATION_FAILED');
    let rpcId = 1;
    async function authenticatedMcp(method, params) {
      return json('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${rotated.body.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
    }
    async function tool(name, args = {}) {
      const answer = await authenticatedMcp('tools/call', { name, arguments: args });
      check(answer.response.ok && !answer.body.error && !answer.body.result?.isError, 'MCP_TOOL_FAILED');
      const content = answer.body.result?.content?.find(value => value.type === 'text')?.text;
      check(typeof content === 'string', 'MCP_TOOL_RESULT_MISSING'); return JSON.parse(content);
    }
    const initialized = await authenticatedMcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-hosted-acceptance', version: '1.0' } });
    check(initialized.response.ok && initialized.body.result?.serverInfo, 'MCP_INITIALIZE_FAILED');
    const listed = await authenticatedMcp('tools/list', {});
    check(listed.response.ok && listed.body.result?.tools?.length === 9 && listed.body.result.tools.every(value => !/publish|submit_score|cancel_tournament/.test(value.name)), 'MCP_TOOL_ALLOWLIST_FAILED');
    check((await tool('list_modules')).length === 7, 'MCP_MODULE_CATALOG_FAILED'); await tool('get_capabilities');
    const draftOperation = randomUUID(), partial = { event: { name: fixture.event.name } };
    const draft = await tool('create_draft', { operation_id: draftOperation, data: { definition: partial } });
    const mainId = draft.tournament_id; check(uuid.test(mainId), 'MCP_DRAFT_CREATION_FAILED');
    report.tournaments.push({ id: mainId, purpose: 'completed_rr4_bronze', status: 'draft' });
    await tool('get_draft', { tournament_id: mainId });
    const updated = await tool('update_draft', { tournament_id: mainId, operation_id: randomUUID(), expected_revision: draft.revision, data: { definition: fixture } });
    const valid = await tool('validate_draft', { tournament_id: mainId }); check(valid.valid === true, 'MCP_DRAFT_VALIDATION_FAILED');
    const preview = await tool('preview_tournament', { tournament_id: mainId }); check(preview.maximumMatches === 10, 'TEN_GAME_PREVIEW_FAILED');
    const review = await tool('get_review_link', { tournament_id: mainId }); check(review.review_url === `${target.origin}/tournaments/${mainId}/builder`, 'OWNER_REVIEW_LINK_FAILED');
    const receipt = await tool('get_operation', { tournament_id: mainId, operation_id: draftOperation }); check(receipt.tournament_id === mainId && receipt.revision === draft.revision, 'MCP_RECEIPT_LOOKUP_FAILED');
    check(updated.revision > draft.revision, 'MCP_UPDATE_REVISION_FAILED');
    mark('real_dcr_pkce_native_consent_mcp_discovery_and_drafting');
    const ownerReview = await snapshot(mainId);
    await command(mainId, 'publishTournament', { reviewed_definition_hash: ownerReview.preview.definitionHash, acknowledged_warning_codes: ownerReview.preview.warningCodes ?? [] });
    report.tournaments[0].status = 'registration_open';
    await revokeNativeGrant();
    const revoked = await authenticatedMcp('tools/call', { name: 'create_draft', arguments: { operation_id: draftOperation, data: { definition: partial } } });
    check(revoked.response.status === 401, 'REVOKED_MCP_RECEIPT_NOT_DENIED');
    const refreshDenied = await json('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: rotated.body.refresh_token, resource: `${target.origin}/api/mcp` }) });
    check(refreshDenied.response.status === 400 && refreshDenied.body.error === 'invalid_grant', 'REVOKED_REFRESH_NOT_DENIED');
    mark('published_owner_review_and_immediate_connector_revocation');

    const published = await snapshot(mainId), consent = { definition_id: published.snapshot.event.definition_id, consent: true };
    for (const client of clients) await command(mainId, 'requestEntry', { ...consent, entry_name: `Synthetic ${client.label}` }, client);
    await command(mainId, 'closeRegistration', {});
    await command(mainId, 'lockRoster', { reviewed_roster_revision: (await snapshot(mainId)).snapshot.event.roster_revision });
    const locked = (await snapshot(mainId)).snapshot, rrIds = locked.matches.map(value => value.id);
    check(locked.matches.length === 6 && locked.teams.filter(value => value.entry_state === 'approved').length === 4, 'FOUR_OWN_CONSENTS_AND_SIX_RR_FIXTURES_FAILED');
    await command(mainId, 'startTournament', {});
    let played = 0, lastConfirmation;
    for (;;) {
      const current = (await snapshot(mainId)).snapshot;
      if (current.event.modular_state === 'completed') break;
      const match = current.matches.find(value => value.is_current && value.status === 'scheduled' && value.team_a_id && value.team_b_id);
      check(Boolean(match) && played < 10, 'RUNTIME_PROGRESSION_STALLED');
      const a = clients.find(value => current.team_members.some(member => member.team_id === match.team_a_id && member.user_id === value.id));
      const b = clients.find(value => current.team_members.some(member => member.team_id === match.team_b_id && member.user_id === value.id));
      check(a && b && a.id !== b.id, 'ACTUAL_OPPOSING_MEMBERSHIP_REQUIRED');
      await command(mainId, 'startMatch', { match_id: match.id }, a);
      await command(mainId, 'submitScore', { match_id: match.id, score_a: a.label < b.label ? 11 : 5, score_b: a.label < b.label ? 5 : 11 }, a);
      const provisional = (await snapshot(mainId)).snapshot;
      if (played === 0) check(provisional.standings.every(value => value.wins === 0), 'PROVISIONAL_SCORE_COUNTED_OFFICIALLY');
      const confirmation = await command(mainId, 'confirmScore', { match_id: match.id, result_revision: provisional.matches.find(value => value.id === match.id).result_revision }, b);
      lastConfirmation = { ...confirmation, client: b }; played++;
    }
    const complete = (await snapshot(mainId)).snapshot;
    const placements = complete.stages.find(value => value.module_id === 'placements').output;
    check(played === 10 && complete.matches.filter(value => value.is_current).length === 10 && complete.event.result_version === 1 && placements.groups.length === 4, 'TEN_ACCEPTED_GAMES_AND_COMPLETE_PLACEMENTS_FAILED');
    check(rrIds.every(id => complete.matches.some(value => value.id === id && value.is_current)), 'RR_UUIDS_CHANGED');
    for (let i = 0; i < 4; i++) {
      const group = placements.groups.find(value => value.rank === i + 1);
      check(group?.entryIds.length === 1, 'FOUR_DISTINCT_PLACEMENTS_REQUIRED');
      const member = complete.team_members.find(value => value.team_id === group.entryIds[0]);
      check(member?.user_id === clients[i].id, 'PLACEMENT_ORDER_INCORRECT');
      report.placements.push({ rank: i + 1, synthetic_label: clients[i].label, entry_id: group.entryIds[0] });
    }
    const replay = await command(mainId, 'confirmScore', lastConfirmation.envelope.data, lastConfirmation.client, lastConfirmation.envelope);
    check(replay.receipt.revision === lastConfirmation.receipt.revision && (await snapshot(mainId)).snapshot.event.result_version === 1, 'COMPLETED_CONFIRMATION_REPLAY_DUPLICATED_RESULTS');
    report.tournaments[0].status = 'completed';
    mark('ten_native_started_submitted_opponent_confirmed_games_after_ai_revocation');
    mark('distinct_first_second_third_fourth_and_stable_completion_receipt');

    // A separate canceled event keeps real concurrency evidence away from the completed result.
    const raceDefinition = structuredClone(fixture);
    raceDefinition.event = { ...raceDefinition.event, name: `[SYNTHETIC CONCURRENCY ${run.slice(0, 8)}] retained audit`, courts: 1 };
    raceDefinition.registration = { ...raceDefinition.registration, min_entries: 2, max_entries: 3 };
    raceDefinition.nodes = raceDefinition.nodes.slice(0, 4).concat({ id: 'result', module: 'placements@1', from: 'rank' });
    const createRace = { operation_id: randomUUID(), data: { definition: raceDefinition } };
    const same = await Promise.all([post('/api/tournament-builder/drafts', createRace, clients[0]), post('/api/tournament-builder/drafts', createRace, clients[0])]);
    check(same.every(value => value.response.ok) && same[0].body.tournament_id === same[1].body.tournament_id && same[0].body.revision === same[1].body.revision, 'LIVE_IDENTICAL_OPERATION_RACE_FAILED');
    const raceId = same[0].body.tournament_id;
    report.tournaments.push({ id: raceId, purpose: 'parallel_http_concurrency_audit', status: 'draft' });
    const raceRevision = same[0].body.revision;
    const updates = await Promise.all([0, 1].map(index => post(`/api/tournament-builder/${raceId}/commands?command=updateDraft`, { operation_id: randomUUID(), expected_revision: raceRevision, data: { definition: { ...raceDefinition, event: { ...raceDefinition.event, name: `${raceDefinition.event.name} revision ${index}` } } } }, clients[0])));
    check(updates.filter(value => value.response.ok).length === 1 && updates.some(value => value.response.status === 409 && value.body.code === 'STALE_REVISION'), 'LIVE_REVISION_RACE_FAILED');
    const raceReview = await snapshot(raceId);
    await command(raceId, 'publishTournament', { reviewed_definition_hash: raceReview.preview.definitionHash, acknowledged_warning_codes: raceReview.preview.warningCodes ?? [] });
    const raceConsent = { consent: true, definition_id: (await snapshot(raceId)).snapshot.event.definition_id };
    for (const client of clients.slice(0, 2)) await command(raceId, 'requestEntry', { ...raceConsent, entry_name: `Synthetic ${client.label}` }, client);
    const admissionRevision = (await snapshot(raceId)).snapshot.event.revision;
    const admissions = await Promise.all(clients.slice(2).map(client => post(`/api/tournament-builder/${raceId}/commands?command=requestEntry`, { operation_id: randomUUID(), expected_revision: admissionRevision, data: { ...raceConsent, entry_name: `Synthetic ${client.label}` } }, client)));
    check(admissions.filter(value => value.response.ok).length === 1 && admissions.some(value => value.response.status === 409 && value.body.code === 'STALE_REVISION'), 'LIVE_LAST_SLOT_SERIALIZATION_FAILED');
    const loser = clients[2 + admissions.findIndex(value => !value.response.ok)];
    const pending = await command(raceId, 'requestEntry', { ...raceConsent, entry_name: `Synthetic ${loser.label}` }, loser);
    check(pending.receipt.data.admission_error === 'CAPACITY_FULL', 'LOSING_LAST_SLOT_NOT_RETAINED_PENDING');
    const ordinary = await clients[0].sdk.rpc('tb_apply_command', { p_actor_id: clients[0].id, p_client_id: 'web', p_operation_id: randomUUID(), p_request_hash: 'a'.repeat(64), p_command: 'updateDraft', p_tournament_id: raceId, p_expected_revision: pending.receipt.revision, p_request: {}, p_effects: { event: { name: 'Forbidden browser effects' } }, p_result: {}, p_grant_id: null });
    check(Boolean(ordinary.error), 'ORDINARY_ROLE_EXECUTED_TRUSTED_EFFECTS');
    await command(raceId, 'closeRegistration', {});
    await command(raceId, 'lockRoster', { reviewed_roster_revision: (await snapshot(raceId)).snapshot.event.roster_revision });
    await command(raceId, 'startTournament', {});
    const startSnapshot = (await snapshot(raceId)).snapshot, candidates = startSnapshot.matches.filter(value => value.is_current && value.status === 'scheduled').slice(0, 2);
    check(candidates.length === 2 && candidates.every(value => value.court_number === 1), 'LIVE_COURT_RACE_FIXTURE_MISSING');
    const starts = await Promise.all(candidates.map(match => post(`/api/tournament-builder/${raceId}/commands?command=startMatch`, { operation_id: randomUUID(), expected_revision: startSnapshot.event.revision, data: { match_id: match.id } }, clients[0])));
    check(starts.filter(value => value.response.ok).length === 1 && starts.some(value => value.body.code === 'STALE_REVISION'), 'LIVE_START_SERIALIZATION_FAILED');
    const blocked = await post(`/api/tournament-builder/${raceId}/commands?command=startMatch`, { operation_id: randomUUID(), expected_revision: (await snapshot(raceId)).snapshot.event.revision, data: { match_id: candidates[starts.findIndex(value => !value.response.ok)].id } }, clients[0]);
    check(blocked.response.status === 400 && blocked.body.code === 'COURT_BUSY', 'LIVE_COURT_OCCUPANCY_NOT_ENFORCED');
    await command(raceId, 'cancelTournament', { reason: 'Synthetic concurrency acceptance complete; retain all audit history.' });
    report.tournaments[1].status = 'cancelled';
    mark('independent_parallel_http_identical_operation_and_revision_races');
    mark('last_slot_one_winner_loser_pending_and_ordinary_role_effects_denied');
    mark('parallel_court_start_serialization_and_live_occupancy_guard');
    report.passed = true;
  } catch (error) {
    report.error_code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'HOSTED_ACCEPTANCE_FAILED';
    report.failed_step = lastStep;
  } finally {
    if (activeGrant && clients[0]) { try { await revokeNativeGrant(); } catch { report.cleanup.oauth_grant_revocation_failed = true; } }
    for (const tournament of report.tournaments) if (!['completed', 'cancelled'].includes(tournament.status) && clients[0]) {
      try {
        const saved = (await snapshot(tournament.id)).snapshot;
        if (!['completed', 'cancelled'].includes(saved.event.modular_state)) await command(tournament.id, 'cancelTournament', { reason: 'Synthetic acceptance stopped; retain all facts and audit evidence.' });
        tournament.status = (await snapshot(tournament.id)).snapshot.event.modular_state;
      } catch { report.cleanup.unfinished_event_cancellation_failed = true; }
    }
    for (const client of clients) { try { await client.sdk.auth.signOut(); } catch { report.cleanup.session_signout_failed = true; } }
    let disabled = 0;
    for (const account of report.accounts) {
      try {
        const own = await service.auth.admin.getUserById(account.id);
        if (own.data.user?.user_metadata?.tb_synthetic_run !== run || own.data.user.user_metadata.tb_synthetic_purpose !== PURPOSE) { report.cleanup.marker_mismatch = true; continue; }
        const banned = await service.auth.admin.updateUserById(account.id, { ban_duration: '8760h' });
        if (!banned.error) disabled++; else report.cleanup.account_disable_failed = true;
      } catch { report.cleanup.account_disable_failed = true; }
    }
    report.cleanup.disabled_synthetic_accounts = disabled;
    report.cleanup.retained_tournaments_and_receipts = true;
    report.cleanup.credentials_or_tokens_saved = false;
    if (disabled !== report.accounts.length || report.cleanup.oauth_grant_revocation_failed || report.cleanup.session_signout_failed || report.cleanup.unfinished_event_cancellation_failed) report.passed = false;
  }
  return report;
}

async function cli() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) process.stdout.write('Prepared only; no requests sent. Run only after deployment approval: vercel env run -e production -- node scripts/tournament-builder/hosted-acceptance.mjs --run --project-ref <production-ref>\n');
  else {
    try {
      const allowed = ['--run', '--management-keys', '--project-ref', '--resume-run', '--account-ids'];
      const valueFlags = ['--project-ref', '--resume-run', '--account-ids'];
      const seen = new Set();
      for (let i = 0; i < args.length; i++) {
        check(allowed.includes(args[i]) && !seen.has(args[i]), 'INVALID_CLI_ARGUMENTS'); seen.add(args[i]);
        if (valueFlags.includes(args[i])) { check(Boolean(args[i + 1]) && !args[i + 1].startsWith('--'), 'INVALID_CLI_ARGUMENTS'); i++; }
      }
      const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
      const env = args.includes('--management-keys') ? managementEnvironment(value('--project-ref')) : process.env;
      const report = await hostedAcceptance({ run: true, projectRef: value('--project-ref'), resumeRun: value('--resume-run'), accountIds: value('--account-ids')?.split(',') }, env);
      process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (!report.passed) process.exitCode = 1;
    } catch (error) { process.stderr.write(`${error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'HOSTED_ACCEPTANCE_PREFLIGHT_FAILED'}\n`); process.exitCode = 1; }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void cli();
