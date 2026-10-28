import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OAUTH_SCOPE, OAUTH_ADMIN_SCOPE, OAUTH_OWNER_SCOPE, DRAFT_PERMISSIONS, createOAuthConfig, getAuthorizationServerMetadata, getProtectedResourceMetadata,
  validateOAuthScope, permissionsForOAuthScope, oauthScopeForPermissions,
  validateRegistration, parseAuthorizationRequest, parseTokenRequest, validateCodeExchange,
  createOAuthSecret, hashOAuthSecret, createAuthorizationRedirect, OAuthProtocolError,
} from "../../lib/tournament-builder/oauth";

const config = createOAuthConfig("https://picktennt.example");
const redirect = "https://claude.ai/api/mcp/auth_callback";
const client = { client_id: "test-client", redirect_uris: [redirect] };
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
function authorization(overrides: Record<string, string> = {}) {
  return new URLSearchParams({ response_type: "code", client_id: client.client_id,
    redirect_uri: redirect, resource: config.resource, scope: OAUTH_SCOPE, state: "opaque+/state=1",
    code_challenge: challenge, code_challenge_method: "S256", ...overrides });
}
function exchange(overrides: Record<string, string> = {}) {
  return new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id,
    redirect_uri: redirect, resource: config.resource, code: "code-secret", code_verifier: verifier,
    ...overrides });
}
function rejectsOAuth(fn: () => unknown, error: string) {
  assert.throws(fn, (e: unknown) => e instanceof OAuthProtocolError && e.error === error);
}

test("metadata pins configured HTTPS origin and resource with only implemented OAuth features", () => {
  assert.equal(config.resource, "https://picktennt.example/api/mcp");
  assert.equal(createOAuthConfig("https://picktennt.example/").issuer, config.issuer);
  const metadata = getAuthorizationServerMetadata(config);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.scopes_supported, [OAUTH_SCOPE, OAUTH_ADMIN_SCOPE, OAUTH_OWNER_SCOPE]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal("client_id_metadata_document_supported" in metadata, false);
  assert.deepEqual(getProtectedResourceMetadata(config).authorization_servers, [config.issuer]);
  for (const origin of ["http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?q=x", "https://example.com#x"]) {
    assert.throws(() => createOAuthConfig(origin));
  }
});

test("owner scope is a separately requested permission and every supported combination remains canonical", () => {
  const scopes = [OAUTH_SCOPE, OAUTH_ADMIN_SCOPE, OAUTH_OWNER_SCOPE];
  for (let mask = 1; mask < 8; mask++) {
    const requested = scopes.filter((_scope, index) => mask & (1 << index));
    assert.equal(validateOAuthScope([...requested].reverse().join(" ")), requested.join(" "));
    const permissions = permissionsForOAuthScope(requested.join(" "));
    assert.equal(permissions.includes("owner:manage"), requested.includes(OAUTH_OWNER_SCOPE));
    assert.equal(oauthScopeForPermissions(permissions), requested.join(" "));
    const stored = parseAuthorizationRequest(authorization({ scope: requested.join(" ") }), client, config);
    assert.doesNotThrow(() => validateCodeExchange(parseTokenRequest(exchange(), config), stored));
  }
  assert.deepEqual(permissionsForOAuthScope(OAUTH_OWNER_SCOPE), ["owner:manage"]);
  assert.equal(permissionsForOAuthScope(`${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}`).includes("owner:manage"), false);
});

test("admin scope is explicit, canonical and independent from default draft access", () => {
  assert.equal(validateOAuthScope(null), OAUTH_SCOPE);
  assert.equal(validateOAuthScope(OAUTH_ADMIN_SCOPE), OAUTH_ADMIN_SCOPE);
  assert.equal(validateOAuthScope(`${OAUTH_ADMIN_SCOPE} ${OAUTH_SCOPE}`), `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}`);
  assert.deepEqual(permissionsForOAuthScope(OAUTH_SCOPE), [...DRAFT_PERMISSIONS]);
  assert.deepEqual(permissionsForOAuthScope(OAUTH_ADMIN_SCOPE), ["admin:manage"]);
  assert.deepEqual(permissionsForOAuthScope(`${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}`), [...DRAFT_PERMISSIONS, "admin:manage"]);
  assert.equal(oauthScopeForPermissions([...DRAFT_PERMISSIONS]), OAUTH_SCOPE);
  assert.equal(oauthScopeForPermissions(["admin:manage"]), OAUTH_ADMIN_SCOPE);
  assert.equal(oauthScopeForPermissions([...DRAFT_PERMISSIONS, "admin:manage"]), `${OAUTH_SCOPE} ${OAUTH_ADMIN_SCOPE}`);
  for (const scope of ["", " ", `${OAUTH_SCOPE} ${OAUTH_SCOPE}`, `${OAUTH_SCOPE} unknown`, `${OAUTH_SCOPE}\t${OAUTH_ADMIN_SCOPE}`]) rejectsOAuth(() => validateOAuthScope(scope), "invalid_scope");
  for (const permissions of [[], ["draft:read"], ["unrecognized:admin"], null]) assert.throws(() => oauthScopeForPermissions(permissions), OAuthProtocolError);
});

test("public DCR accepts only exact supported callback patterns", () => {
  const callbacks = [redirect, "https://chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com/connector/oauth/callback_123-abc"];
  const registration = validateRegistration({ client_name: "My AI", redirect_uris: callbacks });
  assert.deepEqual(registration.redirect_uris, callbacks);
  assert.equal(registration.token_endpoint_auth_method, "none");
  for (const uri of ["https://claude.ai.evil.com/api/mcp/auth_callback", "https://claude.ai/other", `${redirect}?next=evil`, `${redirect}#frag`, "https://user@claude.ai/api/mcp/auth_callback", "https://claude.ai:443/api/mcp/auth_callback", "https://chatgpt.com/connector/oauth/", "https://chatgpt.com/connector/oauth/a/b", "http://localhost:3000/callback"]) {
    rejectsOAuth(() => validateRegistration({ redirect_uris: [uri] }), "invalid_redirect_uri");
  }
});

test("DCR rejects unsupported client auth, grants, response types and metadata", () => {
  for (const extra of [{ token_endpoint_auth_method: "client_secret_post" }, { grant_types: ["password"] }, { response_types: ["token"] }, { scope: "admin" }, { client_name: 2 }, { redirect_uris: [] }, { redirect_uris: [redirect, redirect] }]) {
    assert.throws(() => validateRegistration({ redirect_uris: [redirect], ...extra }), OAuthProtocolError);
  }
});

test("DCR ignores unsupported metadata per RFC 7591 without storing or using it", () => {
  const registration = validateRegistration({ redirect_uris: [redirect], token_endpoint_auth_method: "none",
    contacts: ["support@example.com"], software_id: "Claude", software_version: "1", application_type: "web",
    jwks_uri: "https://attacker.example/keys", software_statement: "untrusted-statement", extension_metadata: { ignored: true } });
  assert.deepEqual(registration, validateRegistration({ redirect_uris: [redirect], token_endpoint_auth_method: "none" }));
  assert.throws(() => validateRegistration({ redirect_uris: ["https://attacker.example/callback"], contacts: [] }), OAuthProtocolError);
});

test("DCR preserves authorization-code-only registrations without granting refresh", () => {
  assert.deepEqual(validateRegistration({ redirect_uris: [redirect], grant_types: ["authorization_code"] }).grant_types, ["authorization_code"]);
  for (const grant_types of [["refresh_token"], ["authorization_code", "authorization_code"], []]) {
    assert.throws(() => validateRegistration({ redirect_uris: [redirect], grant_types }), OAuthProtocolError);
  }
});

test("authorization preserves exact state and binds registered client, scope, redirect and resource", () => {
  const parsed = parseAuthorizationRequest(authorization(), client, config);
  assert.equal(parsed.state, "opaque+/state=1");
  assert.equal(parsed.scope, OAUTH_SCOPE);
  assert.equal(parsed.code_challenge, challenge);
  const invalidRequests: Record<string, string>[] = [{ client_id: "other" }, { redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" }, { resource: "https://other.example/api/mcp" }, { scope: "admin" }, { scope: `${OAUTH_SCOPE} admin` }, { state: "" }, { response_type: "token" }, { code_challenge_method: "plain" }, { code_challenge: "x" }];
  for (const override of invalidRequests) {
    assert.throws(() => parseAuthorizationRequest(authorization(override), client, config), OAuthProtocolError);
  }
});

test("duplicate and unimplemented authorization parameters fail closed", () => {
  const duplicate = authorization();
  duplicate.append("resource", config.resource);
  rejectsOAuth(() => parseAuthorizationRequest(duplicate, client, config), "invalid_request");
  const unsupported: Record<string, string>[] = [{ request_uri: "https://attacker.example" }, { nonce: "oidc-not-supported" }];
  for (const extra of unsupported) {
    rejectsOAuth(() => parseAuthorizationRequest(authorization(extra), client, config), "invalid_request");
  }
});

test("authorization code exchange enforces stored PKCE and exact bindings", () => {
  const stored = parseAuthorizationRequest(authorization(), client, config);
  const request = parseTokenRequest(exchange(), config);
  assert.equal(request.grant_type, "authorization_code");
  assert.doesNotThrow(() => validateCodeExchange(request, stored));
  const wrongBindings: Record<string, string>[] = [{ client_id: "other" }, { redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" }, { code_verifier: "b".repeat(43) }];
  for (const override of wrongBindings) {
    rejectsOAuth(() => validateCodeExchange(parseTokenRequest(exchange(override), config), stored), "invalid_grant");
  }
  rejectsOAuth(() => parseTokenRequest(exchange({ resource: "https://other.example" }), config), "invalid_target");
});

test("token requests reject malformed verifiers, missing resource and extra credentials", () => {
  const malformed: Record<string, string>[] = [{ code_verifier: "short" }, { code_verifier: "=".repeat(43) }, { code: "" }, { resource: "" }, { client_secret: "secret" }, { scope: OAUTH_ADMIN_SCOPE }, { grant_type: "client_credentials" }];
  for (const override of malformed) {
    assert.throws(() => parseTokenRequest(exchange(override), config), OAuthProtocolError);
  }
  const duplicate = exchange(); duplicate.append("client_id", client.client_id);
  rejectsOAuth(() => parseTokenRequest(duplicate, config), "invalid_request");
});

test("refresh accepts only stored resource inheritance or the same explicit target", () => {
  const params = new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: "refresh-secret" });
  const parsed = parseTokenRequest(params, config);
  assert.equal(parsed.grant_type, "refresh_token");
  assert.equal(parsed.resource, config.resource);
  assert.equal(parsed.grant_type === "refresh_token" ? parsed.scope : "unexpected", undefined);
  params.set("resource", "https://other.example");
  rejectsOAuth(() => parseTokenRequest(params, config), "invalid_target");
  params.set("resource", config.resource); params.set("scope", "admin");
  rejectsOAuth(() => parseTokenRequest(params, config), "invalid_scope");
});

test("opaque credentials are random 256-bit values stored as SHA256 digests", () => {
  const first = createOAuthSecret(); const second = createOAuthSecret();
  assert.match(first.value, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.hash, hashOAuthSecret(first.value));
  assert.notEqual(first.value, second.value);
  assert.notEqual(first.hash, first.value);
  assert.equal(hashOAuthSecret("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("success and denial callbacks preserve state and include exact issuer", () => {
  const result = createAuthorizationRedirect(redirect, "state+/==", { code: "opaque-code" }, config);
  assert.equal(result.origin + result.pathname, redirect);
  assert.equal(result.searchParams.get("state"), "state+/==");
  assert.equal(result.searchParams.get("iss"), config.issuer);
  assert.equal(result.searchParams.get("code"), "opaque-code");
  const denied = createAuthorizationRedirect(redirect, "state", { error: "access_denied" }, config);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("iss"), config.issuer);
  assert.equal(denied.searchParams.has("code"), false);
  assert.throws(() => createAuthorizationRedirect("https://evil.example/callback", "state", { code: "secret" }, config));
});
