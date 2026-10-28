import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { storageDatabase, role, owner, stranger } from "./helpers/storage-db";
import { createOAuthConfig, OAUTH_SCOPE, OAUTH_ADMIN_SCOPE, OAUTH_OWNER_SCOPE, DRAFT_PERMISSIONS } from "../../lib/tournament-builder/oauth";
import { createOAuthServer, type OAuthStore } from "../../lib/tournament-builder/oauth-server";

const config = createOAuthConfig("https://picktennt.example");
const callback = "https://claude.ai/api/mcp/auth_callback";
const client = { client_id: "8c48c05c-eb12-4da4-9968-ed4efb785860", client_name: "Claude <script>", redirect_uris: [callback], grant_types: ["authorization_code", "refresh_token"] };
const verifier = "a".repeat(43);
function authUrl(scope: string = OAUTH_SCOPE) {
  return `${config.authorizationEndpoint}?${new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: callback, resource: config.resource, scope, state: "state+/=", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })}`;
}
function setup(signedIn = true, permissions: readonly string[] = DRAFT_PERMISSIONS) {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  let pending: Record<string, unknown> = {};
  const store: OAuthStore = async (action, payload) => {
    calls.push({ action, payload });
    if (action === "rate_limit") return { allowed: true };
    if (action === "get_client" || action === "register_client") return client;
    if (action === "create_authorization") { pending = { ...payload, status: "pending", client_name: client.client_name }; return pending; }
    if (action === "get_authorization") return pending;
    if (action === "approve_authorization" || action === "deny_authorization") return { redirect_uri: callback, state: "state+/=", grant_id: "grant" };
    if (action === "exchange_code" || action === "refresh_token") {
      if (action === "refresh_token" && Array.isArray(payload.requested_scopes) && JSON.stringify([...payload.requested_scopes].sort()) !== JSON.stringify([...permissions].sort())) return { error: "invalid_scope" };
      return { expires_in: 3600, refresh_allowed: true, user_id: "native-user", scopes: [...permissions] };
    }
    if (action === "list_grants") return { grants: [] };
    return { revoked: true };
  };
  const server = createOAuthServer({ config, store, getUser: async () => signedIn ? { id: "native-user", email: "user@example.com" } : null });
  return { server, calls };
}

test("unauthenticated authorize returns through existing login with all OAuth context", async () => {
  const { server, calls } = setup(false);
  const response = await server.authorize(new Request(authUrl()));
  assert.equal(response.status, 303);
  const login = new URL(response.headers.get("location")!);
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("redirect"), new URL(authUrl()).pathname + new URL(authUrl()).search);
  assert.equal(calls.some((call) => call.action === "approve_authorization"), false);
});

test("administration requires a new explicit scope request and native consent without altering draft grants", async () => {
  const original = setup();
  const omitted = new URL(authUrl()); omitted.searchParams.delete("scope");
  const draftConsent = await original.server.authorize(new Request(omitted));
  const draftHtml = await draftConsent.text();
  assert.match(draftHtml, /Allow draft access/);
  assert.doesNotMatch(draftHtml, /<strong>Tournament administration/);
  assert.deepEqual(original.calls.find((call) => call.action === "create_authorization")!.payload.scopes, [...DRAFT_PERMISSIONS]);
  const admin = setup(true, ["admin:manage"]);
  const consent = await admin.server.authorize(new Request(authUrl(OAUTH_ADMIN_SCOPE)));
  const html = await consent.text();
  assert.match(html, /Allow tournament administration/);
  assert.match(html, /current owner or administrator/);
  assert.match(html, /Publishing tournaments, cancelling tournaments, reopening completed results/);
  assert.match(html, /real Picktennt accounts/);
  assert.deepEqual(admin.calls.find((call) => call.action === "create_authorization")!.payload.scopes, ["admin:manage"]);
  assert.equal(admin.calls.some((call) => call.action === "approve_authorization"), false);
  const request_id = html.match(/name="request_id" value="([^"]+)"/)![1];
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  const cookie = consent.headers.get("set-cookie")!.split(";")[0];
  const tampered = await admin.server.authorize(new Request(config.authorizationEndpoint, { method: "POST", headers: { Origin: config.issuer, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request_id, csrf, action: "approve", scope: `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}` }) }));
  assert.equal(tampered.status, 400);
  assert.equal(admin.calls.some((call) => call.action === "approve_authorization"), false);
  const approved = await admin.server.authorize(new Request(config.authorizationEndpoint, { method: "POST", headers: { Origin: config.issuer, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request_id, csrf, action: "approve" }) }));
  assert.equal(approved.status, 303);
  const approval = admin.calls.find((call) => call.action === "approve_authorization")!.payload;
  assert.equal("scopes" in approval, false);
  const combined = setup();
  const combinedResponse = await combined.server.authorize(new Request(authUrl(`${OAUTH_ADMIN_SCOPE} ${OAUTH_SCOPE}`)));
  assert.match(await combinedResponse.text(), /Allow draft and admin access/);
  assert.deepEqual(combined.calls.find((call) => call.action === "create_authorization")!.payload.scopes, [...DRAFT_PERMISSIONS, "admin:manage"]);
  const owner = setup(true, ["owner:manage"]);
  const ownerConsent = await owner.server.authorize(new Request(authUrl(OAUTH_OWNER_SCOPE)));
  const ownerHtml = await ownerConsent.text();
  assert.match(ownerHtml, /Allow owner actions/);
  assert.match(ownerHtml, /publish tournaments, cancel tournaments, reopen completed results/);
  assert.match(ownerHtml, /add or remove tournament administrators/);
  assert.match(ownerHtml, /explicit confirmation of the current action preview and revision/);
  assert.match(ownerHtml, /only for tournaments you currently own/);
  assert.doesNotMatch(ownerHtml, /managing administrators remain on the Picktennt website/);
  assert.deepEqual(owner.calls.find((call) => call.action === "create_authorization")!.payload.scopes, ["owner:manage"]);
  assert.equal(owner.calls.some((call) => call.action === "approve_authorization"), false);
});

test("refresh inherits exact granted permissions and rejects scope expansion or narrowing", async () => {
  for (const permissions of [[...DRAFT_PERMISSIONS], ["admin:manage"], [...DRAFT_PERMISSIONS, "admin:manage"]]) {
    const { server, calls } = setup(true, permissions);
    const refresh = (scope?: string) => server.token(new Request(config.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: "synthetic-refresh", ...(scope !== undefined ? { scope } : {}) }) }));
    const inherited = await refresh();
    assert.equal(inherited.status, 200);
    const expected = permissions.includes("admin:manage") ? permissions.includes("draft:read") ? `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}` : OAUTH_ADMIN_SCOPE : OAUTH_SCOPE;
    assert.equal((await inherited.json()).scope, expected);
    assert.equal("requested_scopes" in calls.find((call) => call.action === "refresh_token")!.payload, false);
    assert.equal((await refresh(expected)).status, 200);
    const different = expected === OAUTH_SCOPE ? `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}` : OAUTH_SCOPE;
    const rejected = await refresh(different);
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "invalid_scope", error_description: "OAuth request rejected." });
  }
});

test("authorize GET displays escaped consent and creates only a user-bound pending request", async () => {
  const { server, calls } = setup();
  const response = await server.authorize(new Request(authUrl()));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Claude &lt;script&gt;/);
  assert.doesNotMatch(html, /Claude <script>/);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(response.headers.get("set-cookie")!, /Secure/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.match(response.headers.get("content-security-policy")!, /form-action 'self' https:\/\/claude\.ai https:\/\/chatgpt\.com;/);
  const pending = calls.find((call) => call.action === "create_authorization")!.payload;
  assert.equal(pending.actor_id, "native-user");
  assert.match(String(pending.csrf_hash), /^[a-f0-9]{64}$/);
  assert.equal(calls.some((call) => call.action === "approve_authorization"), false);
});

test("consent requires same origin and matching browser CSRF before any approval", async () => {
  const { server, calls } = setup();
  const response = await server.authorize(new Request(authUrl()));
  const html = await response.text();
  const id = html.match(/name="request_id" value="([^"]+)"/)![1];
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  for (const [origin, token, browserCookie] of [["https://evil.example", csrf, cookie], [config.issuer, "wrong", cookie], [config.issuer, csrf, ""]]) {
    const denied = await server.authorize(new Request(config.authorizationEndpoint, { method: "POST", headers: { Origin: origin, Cookie: browserCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request_id: id, csrf: token, action: "approve" }) }));
    assert.equal(denied.status, 403);
  }
  assert.equal(calls.some((call) => call.action === "approve_authorization"), false);
  const approved = await server.authorize(new Request(config.authorizationEndpoint, { method: "POST", headers: { Origin: config.issuer, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request_id: id, csrf, action: "approve" }) }));
  assert.equal(approved.status, 303);
  const target = new URL(approved.headers.get("location")!);
  assert.equal(target.searchParams.get("state"), "state+/=");
  assert.equal(target.searchParams.get("iss"), config.issuer);
  const issued = calls.find((call) => call.action === "approve_authorization")!.payload;
  assert.equal(issued.actor_id, "native-user");
  assert.notEqual(issued.code_hash, target.searchParams.get("code"));
});

test("null Origin is rejected with boolean-only CSRF diagnostics even when cookie and proof match", async (t) => {
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const { server, calls } = setup();
  const consent = await server.authorize(new Request(authUrl()));
  const html = await consent.text();
  const request_id = html.match(/name="request_id" value="([^"]+)"/)![1];
  const proof = html.match(/name="csrf" value="([^"]+)"/)![1];
  const cookie = consent.headers.get("set-cookie")!.split(";")[0];
  const response = await server.authorize(new Request(config.authorizationEndpoint, { method: "POST",
    headers: { Origin: "null", Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request_id, csrf: proof, action: "approve" }) }));
  assert.equal(response.status, 403);
  assert.equal(calls.some((call) => call.action === "approve_authorization"), false);
  assert.deepEqual(warnings, [["oauth_consent_csrf_rejected", { origin_present: true, origin_null: true,
    origin_matches: false, csrf_format_valid: true, cookie_present: true, cookie_matches: true }]]);
  assert.doesNotMatch(JSON.stringify(warnings), new RegExp(`${request_id}|${proof}|${config.issuer}`));
});

test("code exchange passes only digests to storage and returns connector-only opaque tokens", async () => {
  const { server, calls } = setup();
  const response = await server.token(new Request(config.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: callback, resource: config.resource, code: "code", code_verifier: verifier }) }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.access_token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.refresh_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.scope, OAUTH_SCOPE);
  assert.equal("user_id" in result, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = calls.find((call) => call.action === "exchange_code")!.payload;
  assert.equal("code_verifier" in payload, false);
  assert.equal("code" in payload, false);
  assert.notEqual(payload.access_hash, result.access_token);
});

test("rate limit and storage failures return safe OAuth errors without issuing credentials", async () => {
  const server = createOAuthServer({ config, getUser: async () => null, store: async () => ({ allowed: false, retry_after: 60 }) });
  const limited = await server.register(new Request(config.registrationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [callback] }) }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  const broken = createOAuthServer({ config, getUser: async () => null, store: async () => { throw new Error("sensitive DB connection detail"); } });
  const response = await broken.register(new Request(config.registrationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /sensitive/);
});

test("registration rejection diagnostics contain only bounded public classifications", async (t) => {
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const { server, calls } = setup();
  const response = await server.register(new Request(config.registrationEndpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer header-secret" },
    body: JSON.stringify({ client_name: "private-name", redirect_uris: [callback], token_endpoint_auth_method: "client_secret_post",
      "unknown-secret-field": "body-secret", client_secret: "client-secret" }),
  }));
  assert.equal(response.status, 400);
  assert.equal(calls.some((call) => call.action === "register_client"), false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "oauth_registration_rejected");
  assert.deepEqual(warnings[0][1], { stage: "validate", error: "invalid_client_metadata",
    fields: ["client_name", "redirect_uris", "token_endpoint_auth_method"], unknown_field_count: 2,
    auth_method: "client_secret_post", redirect_kinds: ["claude"] });
  assert.doesNotMatch(JSON.stringify(warnings), /private-name|body-secret|client-secret|unknown-secret-field|header-secret|Bearer|auth_callback/);
});

test("registration discards extension metadata before storage", async () => {
  const { server, calls } = setup();
  const response = await server.register(new Request(config.registrationEndpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [callback], token_endpoint_auth_method: "none", scope: OAUTH_ADMIN_SCOPE,
      contacts: ["support@example.com"], application_type: "web", software_id: "Claude", arbitrary_extension: true }),
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(calls.find((call) => call.action === "register_client")!.payload, {
    client_name: "Claude", redirect_uris: [callback], token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  });
});

test("external revocation binds token to supplied registered client and stores only digest", async () => {
  const { server, calls } = setup();
  const response = await server.revoke(new Request(config.revocationEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: "opaque-token", client_id: client.client_id }) }));
  assert.equal(response.status, 200);
  const payload = calls.find((call) => call.action === "revoke_token")!.payload;
  assert.equal(payload.client_id, client.client_id);
  assert.equal("token" in payload, false);
});

test("complete HTTP consent, exchange, refresh and revocation work against the actual SQL contract", async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync("supabase/migrations/202610280002_tournament_connector_oauth.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/202610280008_tournament_connector_administration.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/202610280009_tournament_connector_owner_actions.sql", "utf8"));
    const store: OAuthStore = async (action, payload) => role(db, "service_role", owner, async () => {
      const result = await db.query<{ result: Record<string, unknown> }>("select tb_oauth_store($1,$2::jsonb) result", [action, JSON.stringify(payload)]);
      return result.rows[0].result;
    });
    const server = createOAuthServer({ config, store, getUser: async () => ({ id: owner, email: "owner@example.com" }) });
    const registrationResponse = await server.register(new Request(config.registrationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [callback], grant_types: ["authorization_code", "refresh_token"] }) }));
    assert.equal(registrationResponse.status, 201);
    const registration = await registrationResponse.json();
    const authorizeUrl = new URL(authUrl()); authorizeUrl.searchParams.set("client_id", registration.client_id);
    const consent = await server.authorize(new Request(authorizeUrl));
    assert.equal(consent.status, 200);
    const consentHtml = await consent.text();
    const request_id = consentHtml.match(/name="request_id" value="([^"]+)"/)![1];
    const csrf = consentHtml.match(/name="csrf" value="([^"]+)"/)![1];
    const approval = await server.authorize(new Request(config.authorizationEndpoint, { method: "POST", headers: { Origin: config.issuer, Cookie: consent.headers.get("set-cookie")!.split(";")[0], "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request_id, csrf, action: "approve" }) }));
    assert.equal(approval.status, 303);
    const code = new URL(approval.headers.get("location")!).searchParams.get("code")!;
    const exchangeParams = new URLSearchParams({ grant_type: "authorization_code", client_id: registration.client_id, redirect_uri: callback, resource: config.resource, code, code_verifier: verifier });
    const postToken = (params: URLSearchParams) => server.token(new Request(config.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params }));
    const exchanged = await postToken(exchangeParams); assert.equal(exchanged.status, 200);
    const credentials = await exchanged.json();
    const binding = await store("verify_token", { token_hash: createHash("sha256").update(credentials.access_token).digest("hex"), resource: config.resource });
    assert.equal(binding.user_id, owner);
    assert.deepEqual(binding.scopes, ["draft:create", "draft:read", "draft:update", "operation:read"]);
    assert.equal((await postToken(exchangeParams)).status, 400);
    const refreshed = await postToken(new URLSearchParams({ grant_type: "refresh_token", client_id: registration.client_id, refresh_token: credentials.refresh_token }));
    assert.equal(refreshed.status, 200);
    const rotated = await refreshed.json();
    await server.revoke(new Request(config.revocationEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: registration.client_id, token: rotated.refresh_token }) }));
    assert.equal((await store("verify_token", { token_hash: createHash("sha256").update(rotated.access_token).digest("hex"), resource: config.resource })).error, "invalid_token");
  } finally { await db.close(); }
});

test("actual SQL preserves old draft grants across fresh admin consent and rejects refresh scope changes before consumption", async () => {
  const db = await storageDatabase();
  try {
    for (const migration of ["202610280002_tournament_connector_oauth.sql", "202610280008_tournament_connector_administration.sql", "202610280009_tournament_connector_owner_actions.sql"]) await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    let signedInActor = owner;
    const store: OAuthStore = async (action, payload) => role(db, "service_role", owner, async () => {
      const result = await db.query<{ result: Record<string, unknown> }>("select tb_oauth_store($1,$2::jsonb) result", [action, JSON.stringify(payload)]);
      return result.rows[0].result;
    });
    const server = createOAuthServer({ config, store, getUser: async () => ({ id: signedInActor }) });
    const registered = await server.register(new Request(config.registrationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [callback], token_endpoint_auth_method: "none", scope: `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}` }) }));
    assert.equal(registered.status, 201);
    const registration = await registered.json();
    const postToken = (form: Record<string, string>) => server.token(new Request(config.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: registration.client_id, ...form }) }));
    const verify = (token: string) => store("verify_token", { token_hash: createHash("sha256").update(token).digest("hex"), resource: config.resource });
    async function connect(scope: string) {
      const url = new URL(authUrl(scope)); url.searchParams.set("client_id", registration.client_id);
      const consent = await server.authorize(new Request(url)); assert.equal(consent.status, 200);
      const html = await consent.text();
      const request_id = html.match(/name="request_id" value="([^"]+)"/)![1], csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
      const approve = () => server.authorize(new Request(config.authorizationEndpoint, { method: "POST", headers: { Origin: config.issuer, Cookie: consent.headers.get("set-cookie")!.split(";")[0], "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request_id, csrf, action: "approve" }) }));
      signedInActor = stranger;
      assert.equal((await approve()).status, 403);
      signedInActor = owner;
      const approved = await approve(); assert.equal(approved.status, 303);
      const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
      const exchange = { grant_type: "authorization_code", redirect_uri: callback, resource: config.resource, code, code_verifier: verifier };
      assert.equal((await postToken({ ...exchange, code_verifier: "b".repeat(43) })).status, 400);
      const response = await postToken(exchange); assert.equal(response.status, 200);
      const tokens = await response.json(); assert.equal(tokens.scope, scope);
      return { tokens, binding: await verify(tokens.access_token) };
    }
    const original = await connect(OAUTH_SCOPE);
    assert.deepEqual(original.binding.scopes, [...DRAFT_PERMISSIONS]);
    const admin = await connect(OAUTH_ADMIN_SCOPE);
    assert.deepEqual(admin.binding.scopes, ["admin:manage"]);
    const combinedScope = `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}`;
    const combined = await connect(combinedScope);
    assert.deepEqual(combined.binding.scopes, [...DRAFT_PERMISSIONS, "admin:manage"]);
    const ownerConnection = await connect(OAUTH_OWNER_SCOPE);
    assert.deepEqual(ownerConnection.binding.scopes, ["owner:manage"]);
    assert.deepEqual((await verify(original.tokens.access_token)).scopes, [...DRAFT_PERMISSIONS]);
    for (const [connection, invalid, expected] of [[original, OAUTH_ADMIN_SCOPE, OAUTH_SCOPE], [admin, `${combinedScope} ${OAUTH_OWNER_SCOPE}`, OAUTH_ADMIN_SCOPE], [combined, OAUTH_SCOPE, combinedScope], [ownerConnection, `${combinedScope} ${OAUTH_OWNER_SCOPE}`, OAUTH_OWNER_SCOPE]] as const) {
      const form = { grant_type: "refresh_token", refresh_token: connection.tokens.refresh_token };
      const rejected = await postToken({ ...form, scope: invalid }); assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error, "invalid_scope");
      const tokenRow = await db.query<{ consumed_at: string | null }>("select consumed_at from tournament_builder_private.oauth_tokens where token_hash=$1", [createHash("sha256").update(connection.tokens.refresh_token).digest("hex")]);
      assert.equal(tokenRow.rows[0].consumed_at, null);
      const inherited = await postToken(form); assert.equal(inherited.status, 200);
      const rotated = await inherited.json(); assert.equal(rotated.scope, expected);
      if (expected === OAUTH_ADMIN_SCOPE) {
        await store("revoke_grant", { actor_id: owner, grant_id: connection.binding.grant_id });
        assert.equal((await verify(rotated.access_token)).error, "invalid_token");
        const revoked = await postToken({ grant_type: "refresh_token", refresh_token: rotated.refresh_token });
        assert.equal(revoked.status, 400); assert.equal((await revoked.json()).error, "invalid_grant");
      }
    }
  } finally { await db.close(); }
});
