import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createAuthorizationRedirect, createOAuthConfig, createOAuthSecret, hashOAuthSecret,
  OAUTH_SCOPE, OAUTH_ADMIN_SCOPE, OAUTH_OWNER_SCOPE, DRAFT_PERMISSIONS, OAuthProtocolError, parseAuthorizationRequest, parseTokenRequest,
  permissionsForOAuthScope, oauthScopeForPermissions,
  validateRegistration, validateRedirectUri, type OAuthConfig, type OAuthRegisteredClient,
} from "./oauth";

export type OAuthStore = (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
export const OAUTH_PERMISSIONS = [...DRAFT_PERMISSIONS];
interface User { id: string; email?: string }
interface Dependencies { config: OAuthConfig; store: OAuthStore; getUser: () => Promise<User | null> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer" };
function registrationDiagnostic(input: unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const knownFields = ["client_name", "redirect_uris", "token_endpoint_auth_method", "grant_types", "response_types", "scope", "client_uri", "logo_uri", "contacts", "application_type", "software_id", "software_version", "policy_uri", "tos_uri", "jwks_uri", "jwks", "software_statement"];
  const fields = Object.keys(body).filter((field) => knownFields.includes(field));
  const methods = ["none", "client_secret_post", "client_secret_basic", "client_secret_jwt", "private_key_jwt"];
  const auth_method = body.token_endpoint_auth_method === undefined ? "omitted"
    : typeof body.token_endpoint_auth_method === "string" && methods.includes(body.token_endpoint_auth_method) ? body.token_endpoint_auth_method : "unsupported";
  const redirect_kinds = Array.isArray(body.redirect_uris) ? body.redirect_uris.slice(0, 10).map((uri) => {
    try { return new URL(validateRedirectUri(uri)).hostname === "claude.ai" ? "claude" : "chatgpt"; }
    catch { return "unsupported"; }
  }) : [];
  return { fields, unknown_field_count: Object.keys(body).length - fields.length, auth_method, redirect_kinds };
}
function connectionAccessLabel(input: unknown) {
  const permissions = Array.isArray(input) ? input : [];
  return [permissions.includes("draft:read") ? "Draft access" : "", permissions.includes("admin:manage") ? "Tournament administration" : "", permissions.includes("owner:manage") ? "Owner actions and administrator management" : ""].filter(Boolean).join("; ") || "No active permissions";
}
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...extra } });
}
function redirect(url: URL | string, extra: Record<string, string> = {}) {
  return new Response(null, { status: 303, headers: { ...noStore, Location: String(url), ...extra } });
}
function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
function html(title: string, content: string, cookie?: string) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Picktennt</title><style>body{font:16px system-ui;background:#f4f7f5;color:#18372b;margin:0;padding:3rem 1rem}main{max-width:32rem;margin:auto;background:white;border-radius:1.5rem;padding:2rem;box-shadow:0 8px 32px #163a2010}h1{font-size:1.6rem}p{line-height:1.6;overflow-wrap:anywhere}button{font:inherit;padding:.8rem 1.2rem;border-radius:.7rem;border:1px solid #b9cec3;background:#edf4f0;margin:.4rem .4rem .4rem 0;cursor:pointer}button[value=approve]{background:#176849;color:white}small{color:#52675c}</style></head><body><main><small>PICKTENNT</small><h1>${title}</h1>${content}</main></body></html>`, {
    // no-referrer makes native browser form POSTs send Origin:null. Retain the
    // same-origin Origin check while suppressing referrers to external callbacks.
    headers: { ...noStore, "Referrer-Policy": "same-origin", "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff", ...(cookie ? { "Set-Cookie": cookie } : {}) },
  });
}
function cookieName(id: string) { return `__Host-picktennt-oauth-${id}`; }
function cookie(name: string, value: string, age = 600) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
function cookieValue(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim()).filter((item) => item.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : "";
}
function equalSecret(left: string, right: string) {
  return timingSafeEqual(Buffer.from(hashOAuthSecret(left)), Buffer.from(hashOAuthSecret(right)));
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 16384) throw new OAuthProtocolError("invalid_request", "Request body too large.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16384) { await reader.cancel(); throw new OAuthProtocolError("invalid_request", "Request body too large."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function form(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") {
    throw new OAuthProtocolError("invalid_request", "Use form-encoded OAuth parameters.");
  }
  return new URLSearchParams(await boundedBody(request));
}
function only(params: URLSearchParams, keys: string[]) {
  const seen = new Set<string>();
  for (const [key] of params) {
    if (!keys.includes(key) || seen.has(key)) throw new OAuthProtocolError("invalid_request", "Unsupported or duplicate parameter.");
    seen.add(key);
  }
}
function required(params: URLSearchParams, key: string, maximum = 4096) {
  const value = params.get(key);
  if (!value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new OAuthProtocolError("invalid_request", `Invalid ${key}.`);
  return value;
}

export function createOAuthServer({ config, store, getUser }: Dependencies) {
  async function call(action: string, payload: Record<string, unknown>) {
    const result = await store(action, payload);
    if (typeof result.error === "string") {
      const code = ["invalid_grant", "invalid_client", "invalid_request", "invalid_scope", "access_denied", "slow_down"].includes(result.error) ? result.error : "server_error";
      throw new OAuthProtocolError(code, code === "server_error" ? "Authorization service unavailable." : "OAuth request rejected.", code === "slow_down" ? 429 : code === "server_error" ? 500 : 400);
    }
    return result;
  }
  async function limit(request: Request, bucket: string) {
    const address = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const result = await call("rate_limit", { bucket, key_hash: hashOAuthSecret(address) });
    if (result.allowed !== true) throw new OAuthProtocolError("slow_down", "Too many OAuth requests.", 429);
  }
  function safe(handler: (request: Request) => Promise<Response>) {
    return async (request: Request) => {
      try { return await handler(request); }
      catch (error) {
        if (error instanceof OAuthProtocolError) return json({ error: error.error, error_description: error.error_description }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
        return json({ error: "server_error", error_description: "Authorization service unavailable." }, 500);
      }
    };
  }
  async function nativeUser(request: Request): Promise<User | Response> {
    const user = await getUser();
    if (user) return user;
    const url = new URL(request.url);
    const login = new URL("/login", config.issuer);
    login.searchParams.set("redirect", url.pathname + url.search);
    return redirect(login);
  }
  function csrf(request: Request, params: URLSearchParams, name: string) {
    const submitted = params.get("csrf") ?? "";
    const browser = cookieValue(request, name);
    const checks = { origin_present: request.headers.has("origin"), origin_null: request.headers.get("origin") === "null",
      origin_matches: request.headers.get("origin") === config.issuer, csrf_format_valid: /^[A-Za-z0-9_-]{43}$/.test(submitted),
      cookie_present: Boolean(browser), cookie_matches: Boolean(browser) && equalSecret(submitted, browser) };
    if (!checks.origin_matches || !checks.csrf_format_valid || !checks.cookie_present || !checks.cookie_matches) {
      console.warn("oauth_consent_csrf_rejected", checks);
      throw new OAuthProtocolError("access_denied", "Consent verification failed. Reload the consent page.", 403);
    }
    return hashOAuthSecret(submitted);
  }
  const register = safe(async (request) => {
    let input: unknown;
    let stage = "rate_limit";
    try {
      await limit(request, "register");
      stage = "parse";
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new OAuthProtocolError("invalid_request", "Use JSON client metadata.");
      try { input = JSON.parse(await boundedBody(request)); } catch (error) {
        if (error instanceof OAuthProtocolError) throw error;
        throw new OAuthProtocolError("invalid_client_metadata", "Invalid JSON client metadata.");
      }
      stage = "validate";
      const metadata = validateRegistration(input);
      stage = "store";
      const registered = await call("register_client", { ...metadata });
      return json(registered, 201);
    } catch (error) {
      console.warn("oauth_registration_rejected", { stage, error: error instanceof OAuthProtocolError ? error.error : "server_error", ...registrationDiagnostic(input) });
      throw error;
    }
  });
  const authorize = safe(async (request) => {
    await limit(request, "authorize");
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const client_id = required(params, "client_id", 128);
      const client = await call("get_client", { client_id });
      const authorization = parseAuthorizationRequest(params, client as unknown as OAuthRegisteredClient, config);
      const user = await nativeUser(request);
      if (user instanceof Response) return user;
      const id = randomUUID(); const proof = createOAuthSecret();
      await call("create_authorization", { ...authorization, id, actor_id: user.id, csrf_hash: proof.hash, scopes: permissionsForOAuthScope(authorization.scope), expires_at: new Date(Date.now() + 600000).toISOString() });
      const requested = authorization.scope.split(" ");
      const draft = requested.includes(OAUTH_SCOPE), admin = requested.includes(OAUTH_ADMIN_SCOPE), owner = requested.includes(OAUTH_OWNER_SCOPE);
      const disclosure = `${draft ? "<p><strong>Draft access:</strong> create, read, edit, validate, and preview your unpublished tournament drafts.</p>" : ""}${admin ? "<p><strong>Tournament administration:</strong> manage registration, registered player entries, courts, scores, result confirmations and corrections, withdrawals, and ties, only for tournaments where you are a current owner or administrator. Every action rechecks your current role and this connection's permissions.</p>" : ""}${owner ? "<p><strong>Owner actions:</strong> publish tournaments, cancel tournaments, reopen completed results for review, and add or remove tournament administrators, only for tournaments you currently own. These actions require an explicit confirmation of the current action preview and revision. Managing administrators changes who can administer your tournament.</p><p>Account settings remain outside this connection.</p>" : "<p>Publishing tournaments, cancelling tournaments, reopening completed results, and managing administrators remain on the Picktennt website. Account settings remain outside this connection.</p>"}<p>Players must have real Picktennt accounts and satisfy the registration requirements.</p>`;
      const approval = owner ? "Allow owner actions" : admin ? draft ? "Allow draft and admin access" : "Allow tournament administration" : "Allow draft access";
      return html("Connect your AI assistant", `<p><strong>${escapeHtml(client.client_name)}</strong> is requesting access to your Picktennt account <strong>${escapeHtml(user.email ?? user.id)}</strong>.</p>${disclosure}<p><small>Return address: ${escapeHtml(authorization.redirect_uri)}. Client names are supplied by their registrants.</small></p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${id}"><input type="hidden" name="csrf" value="${proof.value}"><button name="action" value="approve">${approval}</button><button name="action" value="deny">Deny</button></form>`, cookie(cookieName(id), proof.value));
    }
    const params = await form(request);
    only(params, ["request_id", "csrf", "action"]);
    const request_id = required(params, "request_id", 36);
    if (!UUID.test(request_id)) throw new OAuthProtocolError("invalid_request", "Invalid authorization request.");
    const csrf_hash = csrf(request, params, cookieName(request_id));
    const user = await getUser();
    if (!user) throw new OAuthProtocolError("access_denied", "Sign in again to approve access.", 403);
    const action = required(params, "action", 7);
    if (action !== "approve" && action !== "deny") throw new OAuthProtocolError("invalid_request", "Invalid consent action.");
    const pending = await call("get_authorization", { request_id });
    if (pending.actor_id !== user.id || pending.status !== "pending" || typeof pending.expires_at !== "string" || Date.parse(pending.expires_at) <= Date.now()) {
      throw new OAuthProtocolError("access_denied", "Authorization request expired or belongs to another user.", 403);
    }
    const code = createOAuthSecret();
    const result = await call(action === "approve" ? "approve_authorization" : "deny_authorization", {
      request_id, actor_id: user.id, csrf_hash,
      ...(action === "approve" ? { grant_id: randomUUID(), code_hash: code.hash } : {}),
    });
    const callback = createAuthorizationRedirect(String(result.redirect_uri), String(result.state), action === "approve" ? { code: code.value } : { error: "access_denied" }, config);
    return redirect(callback, { "Set-Cookie": cookie(cookieName(request_id), "", 0) });
  });
  const token = safe(async (request) => {
    await limit(request, "token");
    if (request.headers.has("authorization")) throw new OAuthProtocolError("invalid_client", "Only public PKCE clients are supported.");
    const params = parseTokenRequest(await form(request), config);
    const client = await call("get_client", { client_id: params.client_id });
    if (!Array.isArray(client.grant_types) || !client.grant_types.includes(params.grant_type)) throw new OAuthProtocolError("unauthorized_client", "Client is not registered for this grant.");
    const access = createOAuthSecret(); const refresh = createOAuthSecret();
    const result = params.grant_type === "authorization_code"
      ? await call("exchange_code", { code_hash: hashOAuthSecret(params.code), client_id: params.client_id, redirect_uri: params.redirect_uri, resource: params.resource, code_challenge: createHash("sha256").update(params.code_verifier).digest("base64url"), access_hash: access.hash, refresh_hash: refresh.hash, family_id: randomUUID() })
      : await call("refresh_token", { refresh_hash: hashOAuthSecret(params.refresh_token), client_id: params.client_id, resource: params.resource, access_hash: access.hash, new_refresh_hash: refresh.hash,
        ...(params.scope !== undefined ? { requested_scopes: permissionsForOAuthScope(params.scope) } : {}) });
    const scope = oauthScopeForPermissions(result.scopes);
    if (params.grant_type === "refresh_token" && params.scope !== undefined && params.scope !== scope) throw new OAuthProtocolError("invalid_scope", "Refresh must retain the granted scope. Reconnect to change permissions.");
    return json({ access_token: access.value, token_type: "Bearer", expires_in: result.expires_in, scope,
      ...(result.refresh_allowed === true ? { refresh_token: refresh.value } : {}) });
  });
  const revoke = safe(async (request) => {
    await limit(request, "token");
    const params = await form(request);
    only(params, ["token", "client_id", "token_type_hint"]);
    const client_id = required(params, "client_id", 128);
    await call("get_client", { client_id });
    await call("revoke_token", { client_id, token_hash: hashOAuthSecret(required(params, "token")) });
    return json({});
  });
  const connections = safe(async (request) => {
    const user = await nativeUser(request);
    if (user instanceof Response) return user;
    const name = "__Host-picktennt-connections";
    if (request.method === "POST") {
      const params = await form(request); only(params, ["grant_id", "csrf"]); csrf(request, params, name);
      const grant_id = required(params, "grant_id", 36);
      if (!UUID.test(grant_id)) throw new OAuthProtocolError("invalid_request", "Invalid connection.");
      await call("revoke_grant", { actor_id: user.id, grant_id });
      return redirect(new URL("/oauth/connections", config.issuer));
    }
    const result = await call("list_grants", { actor_id: user.id });
    const proof = createOAuthSecret();
    const grants = Array.isArray(result.grants) ? (result.grants as Record<string, unknown>[]).filter((grant) => grant.status === "active" && !grant.revoked_at) : [];
    return html("Connected AI assistants", `<p>Signed in as ${escapeHtml(user.email ?? user.id)}. Revoking access stops this connection immediately.</p>${grants.length ? grants.map((grant) => `<form method="post" action="/oauth/connections"><p><strong>${escapeHtml(grant.client_name ?? "AI connector")}</strong></p><p>${connectionAccessLabel(grant.permissions)}</p><input type="hidden" name="grant_id" value="${escapeHtml(grant.id ?? grant.grant_id)}"><input type="hidden" name="csrf" value="${proof.value}"><button>Revoke access</button></form>`).join("") : "<p>No active AI connections.</p>"}`, cookie(name, proof.value));
  });
  return { register, authorize, token, revoke, connections };
}

export async function runtimeOAuthServer() {
  if (process.env.MCP_ENABLED !== "true" || !process.env.APP_ORIGIN) return null;
  const config = createOAuthConfig(process.env.APP_ORIGIN);
  const { createClient, createAdminClient } = await import("../supabase/server");
  const admin = await createAdminClient();
  return createOAuthServer({ config,
    getUser: async () => {
      const native = await createClient();
      const { data, error } = await native.auth.getUser();
      return error || !data.user ? null : { id: data.user.id, email: data.user.email };
    },
    store: async (action, payload) => {
      const { data, error } = await admin.rpc("tb_oauth_store", { p_action: action, p_payload: payload });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("OAuth storage unavailable.");
      return data as Record<string, unknown>;
    },
  });
}

export async function serveOAuth(request: Request, handler: keyof ReturnType<typeof createOAuthServer>) {
  try {
    const server = await runtimeOAuthServer();
    return server ? server[handler](request) : json({ error: "not_found" }, 404);
  } catch { return json({ error: "server_error", error_description: "Authorization service unavailable." }, 500); }
}
