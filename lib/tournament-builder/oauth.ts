import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_SCOPE = "tournaments:draft";
export const OAUTH_ADMIN_SCOPE = "tournaments:admin";
export const OAUTH_OWNER_SCOPE = "tournaments:owner";
export const OAUTH_SCOPES = [OAUTH_SCOPE, OAUTH_ADMIN_SCOPE, OAUTH_OWNER_SCOPE] as const;
export const DRAFT_PERMISSIONS = ["draft:create", "draft:read", "draft:update", "operation:read"] as const;

export class OAuthProtocolError extends Error {
  constructor(readonly error: string, readonly error_description: string, readonly status: number = 400) {
    super(error_description);
    this.name = "OAuthProtocolError";
  }
}

function fail(error: string, description: string): never {
  throw new OAuthProtocolError(error, description);
}

export function createOAuthConfig(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("OAuth requires a configured HTTPS origin without a path, credentials, query, or fragment.");
  }
  const issuer = url.origin;
  return {
    issuer,
    resource: `${issuer}/api/mcp`,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
  };
}
export type OAuthConfig = ReturnType<typeof createOAuthConfig>;

export function getAuthorizationServerMetadata(config: OAuthConfig) {
  return {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    registration_endpoint: config.registrationEndpoint,
    revocation_endpoint: config.revocationEndpoint,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function getProtectedResourceMetadata(config: OAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export function validateRedirectUri(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) fail("invalid_redirect_uri", "Unsupported redirect URI.");
  let url: URL;
  try { url = new URL(value); } catch { fail("invalid_redirect_uri", "Unsupported redirect URI."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.toString() !== value) {
    fail("invalid_redirect_uri", "Unsupported redirect URI.");
  }
  const allowed = (url.hostname === "claude.ai" && url.pathname === "/api/mcp/auth_callback")
    || (url.hostname === "chatgpt.com" && (url.pathname === "/connector_platform_oauth_redirect"
      || /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)));
  if (!allowed) fail("invalid_redirect_uri", "Unsupported redirect URI.");
  return value;
}

export interface OAuthRegistration {
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: ("authorization_code" | "refresh_token")[];
  response_types: ["code"];
}
export interface OAuthRegisteredClient { client_id: string; redirect_uris: string[] }

function exactString(value: unknown, name: string, maximum = 2048): string {
  if (typeof value !== "string" || !value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) {
    fail("invalid_request", `Invalid ${name}.`);
  }
  return value;
}

export function validateRegistration(input: unknown): OAuthRegistration {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_client_metadata", "Expected client metadata.");
  const body = input as Record<string, unknown>;
  // RFC 7591 section 2 requires ignoring metadata we do not understand. Only
  // explicitly selected, validated fields below reach the registration record.
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
    fail("invalid_client_metadata", "Only public PKCE clients are supported.");
  }
  const grants = body.grant_types ?? ["authorization_code", "refresh_token"];
  if (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.length !== new Set(grants).size
    || grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")) {
    fail("invalid_client_metadata", "Unsupported grant_types.");
  }
  if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== "code")) {
    fail("invalid_client_metadata", "Unsupported response_types.");
  }
  if (body.scope !== undefined) validateOAuthScope(body.scope);
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1 || body.redirect_uris.length > 10) {
    fail("invalid_redirect_uri", "Provide one to ten supported redirect URIs.");
  }
  const redirect_uris = body.redirect_uris.map(validateRedirectUri);
  if (new Set(redirect_uris).size !== redirect_uris.length) fail("invalid_redirect_uri", "Duplicate redirect URI.");
  for (const field of ["client_uri", "logo_uri"]) {
    if (body[field] !== undefined) exactString(body[field], field);
  }
  return {
    client_name: body.client_name === undefined ? "AI connector" : exactString(body.client_name, "client_name", 100),
    redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: grants,
    response_types: ["code"],
  };
}

function validateParameters(params: URLSearchParams, allowed: string[]) {
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key) || !allowed.includes(key)) fail("invalid_request", "Duplicate or unsupported OAuth parameter.");
    seen.add(key);
  }
}
function parameter(params: URLSearchParams, name: string, maximum = 2048) {
  return exactString(params.get(name), name, maximum);
}
export function validateOAuthScope(value: unknown): string {
  if (value === null) return OAUTH_SCOPE;
  if (typeof value !== "string" || value.length > 100) fail("invalid_scope", "Unsupported scope.");
  const requested = value.split(" ");
  if (requested.length === 0 || new Set(requested).size !== requested.length || requested.some((scope) => !OAUTH_SCOPES.some((supported) => scope === supported))) fail("invalid_scope", "Unsupported scope.");
  return OAUTH_SCOPES.filter((scope) => requested.includes(scope)).join(" ");
}
export function permissionsForOAuthScope(scope: string): string[] {
  const requested = validateOAuthScope(scope).split(" ");
  return [...(requested.includes(OAUTH_SCOPE) ? DRAFT_PERMISSIONS : []), ...(requested.includes(OAUTH_ADMIN_SCOPE) ? ["admin:manage"] : []), ...(requested.includes(OAUTH_OWNER_SCOPE) ? ["owner:manage"] : [])];
}
export function oauthScopeForPermissions(input: unknown): string {
  if (!Array.isArray(input) || input.length === 0 || input.some((permission) => ![...DRAFT_PERMISSIONS, "admin:manage", "owner:manage"].includes(permission))) {
    throw new OAuthProtocolError("server_error", "Invalid stored token permissions.", 500);
  }
  const draft = DRAFT_PERMISSIONS.every((permission) => input.includes(permission));
  if (!draft && input.some((permission) => DRAFT_PERMISSIONS.includes(permission))) throw new OAuthProtocolError("server_error", "Invalid stored token permissions.", 500);
  return [...(draft ? [OAUTH_SCOPE] : []), ...(input.includes("admin:manage") ? [OAUTH_ADMIN_SCOPE] : []), ...(input.includes("owner:manage") ? [OAUTH_OWNER_SCOPE] : [])].join(" ");
}
function validateResource(value: string | null, config: OAuthConfig) {
  if (value !== config.resource) fail("invalid_target", "Token resource must match the configured MCP resource.");
  return config.resource;
}

export interface OAuthAuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  resource: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
}
export function parseAuthorizationRequest(params: URLSearchParams, client: OAuthRegisteredClient, config: OAuthConfig): OAuthAuthorizationRequest {
  validateParameters(params, ["response_type", "client_id", "redirect_uri", "resource", "scope", "state", "code_challenge", "code_challenge_method"]);
  if (params.get("response_type") !== "code") fail("unsupported_response_type", "Only authorization code is supported.");
  const client_id = parameter(params, "client_id", 128);
  if (client_id !== client.client_id) fail("invalid_client", "Unknown client.");
  const redirect_uri = validateRedirectUri(params.get("redirect_uri"));
  if (!client.redirect_uris.includes(redirect_uri)) fail("invalid_request", "Redirect URI is not registered to this client.");
  const resource = validateResource(params.get("resource"), config);
  const scope = validateOAuthScope(params.get("scope"));
  const state = parameter(params, "state");
  const code_challenge = parameter(params, "code_challenge", 43);
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(code_challenge)) {
    fail("invalid_request", "A valid S256 PKCE challenge is required.");
  }
  return { client_id, redirect_uri, resource, scope, state, code_challenge, code_challenge_method: "S256" };
}

export interface OAuthCodeExchange {
  grant_type: "authorization_code"; client_id: string; redirect_uri: string;
  resource: string; code: string; code_verifier: string;
}
export interface OAuthRefreshExchange {
  grant_type: "refresh_token"; client_id: string; resource: string;
  refresh_token: string; scope?: string;
}
export type OAuthTokenRequest = OAuthCodeExchange | OAuthRefreshExchange;

export function parseTokenRequest(params: URLSearchParams, config: OAuthConfig): OAuthTokenRequest {
  const grant_type = params.get("grant_type");
  if (grant_type !== "authorization_code" && grant_type !== "refresh_token") fail("unsupported_grant_type", "Unsupported grant type.");
  validateParameters(params, grant_type === "authorization_code"
    ? ["grant_type", "client_id", "redirect_uri", "resource", "code", "code_verifier"]
    : ["grant_type", "client_id", "resource", "refresh_token", "scope"]);
  const client_id = parameter(params, "client_id", 128);
  const resource = validateResource(grant_type === "refresh_token" && !params.has("resource") ? config.resource : params.get("resource"), config);
  if (grant_type === "refresh_token") {
    return { grant_type, client_id, resource, refresh_token: parameter(params, "refresh_token", 4096), ...(params.has("scope") ? { scope: validateOAuthScope(params.get("scope")) } : {}) };
  }
  const code_verifier = parameter(params, "code_verifier", 128);
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier)) fail("invalid_request", "Invalid PKCE verifier.");
  return { grant_type, client_id, resource, redirect_uri: validateRedirectUri(params.get("redirect_uri")), code: parameter(params, "code", 4096), code_verifier };
}

export function validateCodeExchange(request: OAuthTokenRequest, stored: OAuthAuthorizationRequest): asserts request is OAuthCodeExchange {
  let validScope = false;
  try { validScope = validateOAuthScope(stored.scope) === stored.scope; } catch {}
  if (request.grant_type !== "authorization_code" || request.client_id !== stored.client_id || request.redirect_uri !== stored.redirect_uri
    || request.resource !== stored.resource || !validScope || stored.code_challenge_method !== "S256") {
    fail("invalid_grant", "Invalid authorization grant.");
  }
  const challenge = createHash("sha256").update(request.code_verifier).digest("base64url");
  const expected = Buffer.from(stored.code_challenge);
  const actual = Buffer.from(challenge);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) fail("invalid_grant", "Invalid authorization grant.");
}

export function hashOAuthSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function createOAuthSecret(): { value: string; hash: string } {
  const value = randomBytes(32).toString("base64url");
  return { value, hash: hashOAuthSecret(value) };
}

export function createAuthorizationRedirect(redirect_uri: string, state: string, result: { code: string } | { error: string }, config: OAuthConfig): URL {
  const url = new URL(validateRedirectUri(redirect_uri));
  url.searchParams.set("state", exactString(state, "state"));
  url.searchParams.set("iss", config.issuer);
  if ("code" in result) url.searchParams.set("code", result.code);
  else url.searchParams.set("error", result.error);
  return url;
}
