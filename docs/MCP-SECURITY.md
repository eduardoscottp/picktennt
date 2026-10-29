# Picktennt MCP security contract

Status: implemented and tested locally on 29 October 2026. This document does not assert deployment or production penetration-test coverage. See [verification evidence](evidence/mcp-security-2026-10-29.md).

The approved dependency follow-up updated Next.js to 16.4.3, sharp to 0.35.5, source-map-js to 1.2.2 and Zod to 4.6.7. Fresh production and full npm audits report zero known vulnerabilities; the updated build and security suite pass locally.

## Data boundary

The MCP is a constrained tournament adapter. A connected player or organizer cannot use it to inspect database tables, hosting, filesystem paths, source code, environment variables, credentials, deployment configuration, account directories, or unrelated accounts. There are no SQL, shell, code execution, arbitrary URL fetch, file access, impersonation, permission editing, or server modification tools.

Public OAuth discovery, the public application/review URL, and supported tournament tool schemas must remain visible for client interoperability. These describe the product interface. They do not grant access to internal infrastructure.

Tournament reads expose an explicit public projection: current rules, revisions, authorized roster names/account references, entry state, matches, schedules, standings, qualification/tie information, placements, and tournament administrators. Account references are necessary for authorized enrollment and tournament actions; emails, contact details, authentication records, join codes, storage hashes, audit internals and unrelated profile properties are not returned. A new storage column is excluded until deliberately added to the public contract.

Draft, receipt, lookup and impact-preview responses have separate field allowlists. Raw storage snapshots and raw command receipts never cross the MCP response boundary. Generic errors exclude exception messages, SQL/provider diagnostics, stack traces, unknown error codes and nested error details. Missing and forbidden resources produce the same tool error.

The output tripwire withholds recognizable credentials and private infrastructure strings even inside otherwise allowed text. It supplements data minimization; it cannot recognize every possible secret format. Real secrets must never enter tournament names, reasons, or other user-facing data.

## Authentication and authorization

1. Accept opaque bearer credentials only from the Authorization header. Cookies and query-string tokens do not authenticate the MCP.
2. Hash the bearer credential before database verification. Verify its exact configured resource, expiry, token family, current grant and current permissions on each request. Do not accept the reserved native-web client identity from an MCP token.
3. Advertise and dispatch only tools allowed by verified permissions. Draft, routine administration and owner permissions remain separate. No existing grant receives new permission automatically.
4. Authorize every resource access and mutation again in the repository/database. Current ownership, administrator membership and grant state take precedence over token-time claims or an old receipt. Request data cannot supply actor, role, client or grant authority.
5. Preserve revision checks, exact preview hashes, idempotent operation IDs, transactional application and database write guards. Replaying a receipt cannot restore revoked rights.
6. Exact-username profile lookup requires current tournament administrator or owner authority and returns only the account reference, username and display name needed for the authorized task. It is not an account-list or private-profile tool.

## Untrusted input and client instructions

Validate every tool argument against its advertised JSON Schema before dispatch, including nested properties, required fields, formats, enums, lengths and numeric bounds. Reject prototype-related keys and data exceeding nesting/work limits. Only supported graph blocks and routing references are accepted; tournament definitions cannot contain executable expressions or new server capabilities.

All player-controlled text is data. Initialization instructions explicitly prohibit interpreting names/reasons as instructions, changing security policy, exposing private information, executing code or inventing personal consent. Permissions and validation are enforced by server code regardless of whether the client follows those instructions.

Owner and structural actions retain current impact preview and confirmation requirements. Confirmation flags are supplied by the authorized MCP client; they are not independent cryptographic evidence of a human click. A compromised client holding owner permission can exercise that permission. Use the narrowest grants and revoke compromised connections. This patch does not claim to control an external model's reasoning or eliminate all prompt injection.

## Transport and resource controls

- Restrict browser origins to the configured application and supported clients; reject null or lookalike origins.
- Permit only the supported stateless JSON-RPC methods. Authenticated GET/DELETE receive 405; notifications use the supported JSON-RPC notification form.
- Require JSON, a single message and bounded request IDs. Reject request batches, unknown methods, invalid shapes, malformed JSON and parser diagnostics without reflecting their content.
- Stream-count request bytes: maximum 65,536 bytes. Limit input nesting to 24 and visited JSON values to 20,000.
- Limit public results to 524,288 serialized UTF-8 bytes and bounded JSON work. Match reads use 64-item pages and their corresponding rounds, with `match_page.total` and `next_offset`; supply `match_offset` to continue and compare the tournament revision between pages.
- Use the existing atomic persistent limiter with an MCP-specific account key: 60 authenticated requests/minute per account across clients and instances. Keys are independent of OAuth IP keys. Return 429/Retry-After or fail closed if the limiter is unavailable.
- Mark all MCP responses, including failures, `no-store`; set `nosniff` and suppress referrers. Review links must exactly match the configured public origin and requested tournament.

## Operational boundaries

The runtime still holds a server-side administrative database credential. That credential never enters tool arguments or responses, and its client does not use browser session cookies. A host/process compromise remains outside these tool-level controls. Protect deployment credentials, restrict infrastructure access and rotate exposed credentials through the hosting/secret-management systems.

Apply edge request-rate and connection/body time limits before authentication to protect the verifier from anonymous floods. The new account limiter begins after token verification and does not establish distributed-denial-of-service protection. No destructive production load test was run.

Record security events using fixed event/code categories and minimal operational metadata. Do not log bearer tokens, request bodies, credentials, private player text or raw database errors into client-visible channels. Existing command history/receipts remain the audit trail for authorized mutations.

Production release must use the reviewed feature allowlist and existing release workflow. This work needs no database migration. Deploy only after the owner authorizes production release; then smoke-test a dedicated owner's and second account's access and revoke synthetic grants. Never describe local PGlite tests as production PostgreSQL verification or a real Claude acceptance session.

## Reference threats

The audit covers relevant [MCP security threats](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices), [resource-bound MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and [OWASP object-level authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/). These references guide test selection; passing these tests is not a certification against every attack.
