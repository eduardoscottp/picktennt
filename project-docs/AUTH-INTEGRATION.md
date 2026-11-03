# Remote MCP authentication contract

Implementation contract and local verification notes, 2026-10-28. Supabase built-in OAuth is not used. Hosted deployment and migration evidence is recorded separately; these local results do not prove a live Google, ChatGPT, or Claude connection.

## Decision

Use the existing Picktennt Google login to identify the consenting user, then issue **separate opaque connector credentials**. Never return a Supabase user access/refresh token to ChatGPT or Claude. Keep production Supabase OAuth disabled for this MVP.

The resource server resolves a connector token to its live grant and user ID, then calls only the narrow tournament draft operations. Server credentials stay on the server; a connector cannot choose an arbitrary database table, RPC, user ID, or operation.

## Verified findings and remaining uncertainty

- Installed `app/node_modules/@supabase/auth-js/src/GoTrueClient.ts:5547` implements OAuth authorization details, approve, deny, list grants, and revoke. The existing login/callback supports returning to an internal consent URL.
- Installed `GoTrueClient.ts:5868` verifies JWT signature/expiry through `getClaims`; its asymmetric path does not check issuer, audience, not-before, or active session. These require separate checks when JWTs are used.
- Supabase supports PKCE, DCR, consent, and token hooks. Default OAuth tokens have the normal authenticated role/audience; OIDC scopes do not narrow database permissions. A hook can change claims, including audience. [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security), [hook input contract](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
- Current upstream source stores the authorization `resource`, but token generation defaults audience to the user's audience. Resource handling also differs between JSON and form token requests. Full RFC8707 behavior on the hosted deployment is unverified. [Authorize handler](https://github.com/supabase/auth/blob/master/internal/api/oauthserver/authorize.go), [token handler](https://github.com/supabase/auth/blob/master/internal/api/oauthserver/handlers.go), [token generation](https://github.com/supabase/auth/blob/master/internal/tokens/service.go).
- **Security inference from upstream source:** changing a token's PostgreSQL role does not isolate Supabase Auth account operations. `/user` PUT is guarded by ordinary bearer authentication; user-update code contains no connector-client restriction and can set an account password. Auth middleware loads users/sessions by token IDs. A dedicated database role therefore addresses only part of the escape surface. No exploit was attempted, and hosted gateway behavior is unverified. [Routes](https://github.com/supabase/auth/blob/master/internal/api/api.go), [account update](https://github.com/supabase/auth/blob/master/internal/api/user.go), [bearer validation](https://github.com/supabase/auth/blob/master/internal/api/auth.go).

## Minimal OAuth surface

Use a configured HTTPS issuer/origin and exact MCP resource URL, never request-supplied Host headers.

1. Protected-resource metadata names the exact canonical `/api/mcp` resource and authorization server. Unauthorized MCP responses include `WWW-Authenticate` with the metadata URL. Each authenticated tool describes its OAuth security scheme.
2. Authorization-server metadata publishes authorize, token, register, and revoke endpoints; `S256`; `code`; `authorization_code` and `refresh_token`; and public-client token authentication `none`. Do not advertise CIMD, OIDC, issuer-response support, or confidential methods until implemented completely.
3. DCR accepts public PKCE clients only. Validate and store complete redirect URLs. Allow only explicitly supported ChatGPT/Claude host/path combinations; no wildcard domains, fragments, credentials, ports, or arbitrary redirect/query parameters. Registered authorization requests must match stored redirect strings exactly. A DCR display name does not authenticate a company.
4. Authorize validates client, redirect, response type, exact resource, requested supported scopes, and S256 challenge **before redirecting**. Store an expiring pending request. Existing first-party login authenticates the browser; user explicitly approves the displayed client, account, and draft-only access. Approval is POST with CSRF protection and current user verification. Preserve client `state` exactly. Denial issues no grant/code.
5. Generate cryptographically random 32-byte codes/tokens; store SHA256 digests only. Suggested limits: pending request 10 minutes, code 2 minutes, access token 1 hour, refresh token 30 days maximum. Return credentials only once with `Cache-Control: no-store`. Use 303 after consent POST so callbacks receive GET.
6. Token exchange requires exact client/redirect/resource binding and a valid S256 verifier. Atomically consume the code and create grant-linked access/refresh tokens. Refresh rotates atomically; reuse of a consumed refresh token revokes its entire family. Refresh cannot expand resource, scope, or user identity. Require the resource on initial exchange; a missing refresh resource can inherit the stored resource, while a differing resource fails.
7. Validate every MCP call against token expiry, live grant, expected resource/scope, and revoked state. Revocation immediately disables access and refresh credentials. Native signed-in account settings can list/revoke only that user's grants. Unknown token revocation returns an uninformative success response.

The OpenAI contract requires resource binding, discovery, and full per-request resource-server checks. Use the exact redirect shown by the connection UI; callback paths can differ by issuer-identification mode. [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

Claude supports automatic registration and manually configured OAuth clients. Its remote connection originates from Anthropic's cloud. The supported callback is `https://claude.ai/api/mcp/auth_callback`; POST consent responses must redirect using 303/302. [Claude connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Anthropic callback clarification](https://github.com/anthropics/claude-ai-mcp/issues/109).

Registration ignores unsupported metadata and stores only explicitly validated fields, as [RFC 7591 section 2](https://www.rfc-editor.org/rfc/rfc7591#section-2) requires. Redirect URLs, public-client authentication, supported grants, response types, and scope remain validated. Rejections log only a fixed stage/error, recognized metadata field names, unknown-field count, recognized authentication-method classification, and supported-callback classification; request values, credentials, headers, and OAuth state are excluded. The first actual Claude registration returned HTTP 400; its exact rejected metadata was unavailable. The standards mismatch was corrected, but actual-client success still requires a fresh connection. [Current Claude authentication requirements](https://claude.com/docs/connectors/building/authentication) confirm public DCR, S256, refresh rotation, and a ten-second registration response deadline.

Claude subsequently passed registration and reached native consent, where the browser POST failed the exact-origin CSRF check. An un-intercepted local Chrome reproduction confirmed matching cookie and CSRF proof but `Origin: null`, caused by the HTML's `Referrer-Policy: no-referrer`. The [Fetch Origin-header algorithm](https://fetch.spec.whatwg.org/#append-a-request-origin-header) specifies this behavior for native POST navigation. OAuth HTML now uses `same-origin`, which retains the form's origin and suppresses cross-origin referrers; token/JSON/redirect responses keep `no-referrer`. Exact-origin, cookie, proof, native-user and stored-request bindings remain enforced. Null origins are still rejected. `tests/e2e/oauth-consent-origin.ts` verifies both approval and revocation with failing old-policy controls and passing native product forms. The earlier full smoke's Playwright consent interception masked this behavior; that test now preserves native POST headers and changes only the outbound callback in its local HTTPS proxy.

## Storage and atomicity

Minimal logical records: registered clients; expiring authorization requests; user/client/resource/scope grants; one-use code digests; access/refresh token digests with expiry and family linkage. All connector credential records are inaccessible through ordinary anon/authenticated table access. PUBLIC cannot execute service-only credential RPCs.

Exchange, refresh rotation/reuse revocation, and grant revocation must be transactions with row locks. Validation joins the live grant; there is no positive token cache that survives revocation. Browser grant listing/revocation derives the owner from `auth.uid()`, never a supplied user ID. Internal service RPCs take verified connector identity and expose only supported draft commands.

## Release verification

- Real ChatGPT and Claude: registration, discovery, Google login return, explicit approval/deny, token exchange, tools/list, draft create/read/update/validate/preview, refresh, revoke, reconnect.
- Protocol negatives: bad client/redirect/resource/scope, plain or missing PKCE, wrong verifier, expired/replayed/concurrently exchanged code, CSRF, external return URL, malformed token, refresh reuse/concurrent rotation, scope expansion.
- Boundary negatives: connector bearer rejected by Supabase REST/RPC/Auth and every ordinary Picktennt API; native Supabase JWT rejected by MCP; another user's grant/draft cannot be read or changed; revoked tokens fail immediately.
- Deployment gate: HTTPS final origin, exact callback URLs from both clients, configured resource/issuer consistency, migration privileges, rate limits on registration/authorize/token, no token logging, and no secrets in browser bundles or artifacts.

Passing local protocol tests does not prove either actual host is connected. Production migration and public deployment remain separate approval/execution steps.

## Implemented local verification

The application includes the pure OAuth helpers, public OAuth routes, an explicit browser consent screen, native connection revocation, and server-only hashed credential storage. `MCP_ENABLED=true`, `TOURNAMENT_BUILDER_ENABLED=true`, and the exact HTTPS `APP_ORIGIN` are required for the complete experience.

The local Chrome smoke passed six cases against actual Next pages and PGlite SQL: owner draft review/publication, two independent player consents, recovery after a committed score's response was interrupted, opposing-player confirmation and final placements, browser OAuth consent/token/revocation, and a separate read-only shared-third render fixture. Auth/REST were simulated. The callback receiver verified the registered Claude location, state, issuer, and 303-to-GET behavior before substituting a local receiver; it did not authenticate with Claude.

This browser check caught and verified a consent CSP correction: `form-action` must allow the trusted client origins because Chrome checks the downstream redirect as well. Redirect creation still checks the complete callback URL against the strict allowlist.

Reproduce with `node --import tsx tests/e2e/tournament-smoke.ts` from `app/`. See `app/tests/e2e/README.md` for the localhost-only environment and evidence limitations. Results are written under the ignored `app/test-results/tournament-smoke/` directory.
