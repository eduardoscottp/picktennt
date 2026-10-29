# MCP security hardening and adversarial verification

Date: 29 October 2026. Scope: the local tournament-builder application and its MCP/OAuth/database boundaries. Deployment status: **local changes only; not deployed**. No production data, account, grant or database migration was changed.

## Outcome

The MCP now validates complete tool schemas, minimizes response fields, hides internal errors, separates tool discovery by actual permission, bounds request/response work, restricts review links, and rate-limits authenticated accounts using existing persistent storage. No arbitrary execution, system inspection, permission editing or self-modification tool exists. See the complete [security contract](../MCP-SECURITY.md).

The audit established a baseline of 257 passing tests. New attack tests were run against the old boundary and observed failing before fixes. The final suite contains **281 passing tests, zero failures**, including 24 new security/regression tests with multiple attack payloads per test. Existing SQL authorization, OAuth replay and tournament regression suites are included in that total. No claim is made that all possible attacks have been tested.

## Findings and remediation

| Finding | Evidence and significance | Remediation |
| --- | --- | --- |
| Raw storage response exposure | Administrator/owner reads returned whole snapshots, including internal columns and join codes. Synthetic private fields added to snapshots, player lookups, draft definitions and receipts crossed the old MCP boundary. This was a local proof, not evidence of a production credential breach. | Explicit per-tool public projections; nested definitions are projected too. New columns stay private by default. |
| Error disclosure surface | DomainError messages/details were forwarded to clients. SDK invalid initialization requests also returned schema diagnostics in HTTP 200 JSON-RPC errors. | Fixed safe messages and codes, no raw details, identical forbidden/missing errors; sanitize both transport errors and successful-HTTP protocol errors. |
| Incomplete boundary validation | Advertised nested schemas were not fully enforced before dependency dispatch. Synthetic actor/permission/SQL/code/environment/prototype fields reached the old test dispatch. The command planner/database already reject many such requests; this did not establish a working privilege escalation. | Compile and enforce the advertised schemas, reject prototype keys, bound JSON depth/work, and validate message envelopes. |
| Excess tool discovery | Read-only grants discovered draft mutation tools even though the database rejected unauthorized execution. | Filter discovery and dispatch by verified draft/admin/owner permissions. Reject unknown permissions and the reserved web client identity. |
| Supplemental output protection | Allowed free text previously had no credential/infrastructure tripwire; review-link safety relied entirely on the current provider implementation. | Withhold recognizable private credentials/infrastructure text and require the exact configured tournament review URL. No unrestricted fetch was added. |
| Availability and bounded results | No persistent account throttle existed on the MCP request path. New output limits initially blocked supported large graphs. Review reproduced a valid 1,441-match event. | Reuse the atomic limiter with a distinct account key, 60 requests/minute. Return matches in pages of 64. Preserve finalized graphs, ranking/tie state and exact intervention impact. |

No additional high/medium authorization or arbitrary-execution issue was found in the focused independent code review. That review is not a third-party penetration-test certification.

## Attack coverage

- Cross-account private draft reads/updates, review links and operation receipts through HTTP → verified opaque token → repository → local SQL functions. Foreign access fails without returning the private event name; failed writes do not change revision.
- Immediate grant revocation, reduced permissions, administrator removal and revoked receipt recovery. Existing SQL tests check authorization before historical receipt return.
- OAuth wrong client/resource/redirect/PKCE binding, expired or reused authorization codes, refresh replay/family revocation, scope escalation and consent/CSRF binding in the existing OAuth suites.
- Scope/role/client/grant injection, extra nested data, prototype pollution keys, invalid enums/UUIDs/types/bounds, missing required properties and missing confirmation.
- Unsupported SQL, shell, filesystem, environment, arbitrary fetch, impersonation, account-list and server-modification tool names. No dispatch occurs.
- SQL/shell/JavaScript strings saved as inert draft text; local accounts and grant permissions remain unchanged. Stored prompt-injection text cannot register new tools or override server permissions.
- Synthetic credential, private infrastructure URL, private-key, local-path and secret-assignment strings; raw snapshot/receipt/provider-error canaries are withheld.
- Wrong/null/lookalike origins; malformed bearer tokens; cookies/query tokens; unknown methods; request batches; malformed JSON; oversized bodies; excessive nesting; unsafe IDs; SDK diagnostic errors.
- Persistent rate-limit exhaustion and separate account/OAuth keys; limiter/verifier failures fail closed with generic responses.
- Real SDK StreamableHTTPClientTransport initialization, security instructions, discovery and ordinary tool calls. This is a local SDK client test, not a Claude/ChatGPT account acceptance session.
- Projection regressions: finalized knockout graph, underfilled seed assignments, tie information, corrected winner, withdrawal empty-slot warning, match pagination and UTF-8 byte limits.

## Verification evidence

| Check | Result | Evidence under repository root |
| --- | --- | --- |
| Baseline `npm test` | 257 passed | `verification-local/security-baseline-2026-10-29.log` |
| Initial new attack tests before changes | 8 failed as expected | `verification-local/security-red-2026-10-29.log` |
| Full final `npm test` | 281 passed, zero failed | `verification-local/security-full-2026-10-29.log` |
| `npx tsc --noEmit` | Passed | `verification-local/security-types-2026-10-29.log` |
| Scoped ESLint for MCP source/tests and bundle scanner | Passed | `verification-local/security-lint-2026-10-29.log`, `security-bundle-scanner-lint-2026-10-29.log` |
| Isolated Next.js webpack production build | Passed; 34 static pages generated | `verification-local/security-build-2026-10-29.log` |
| Browser-bundle secret canary scan | 78 artifacts; zero synthetic service-key matches | `verification-local/security-client-bundle-2026-10-29.log` |
| Scanner positive control | Detects a deliberately planted synthetic value | `verification-local/security-scanner-positive-2026-10-29.log` |
| Source whitespace check | Passed | `git diff --check` on changed tracked MCP files |

Builds used an isolated source copy with no `.env` files copied and telemetry disabled. A synthetic service-role value was provided in process memory for the final build/bundle scan. No actual production secret was available to the scanner, so the result is **synthetic build-boundary evidence**, not a production-secret inventory or rotation check. The initial empty-secret scan deliberately failed rather than falsely reporting success.

Local Windows sandbox build attempts first hit dependency-junction restrictions, inherited Node worker flags and cleanup EPERM. Verification used a fresh isolated folder, explicit local build permission, and cleared build-bootstrap exec arguments. These environmental attempts are not presented as successful builds.

## Approved dependency audit and remediation

After the user explicitly approved sending dependency names and versions to npm, the advisory audit completed. It initially reported **four affected production packages: one critical and three high**. These are package-level audit counts; Next.js matched multiple advisories. This is evidence of affected installed versions, not a claim that the application was exploited.

| Package | Before | Verified local version | Advisory scope |
| --- | --- | --- | --- |
| Next.js | 16.3.6 | 16.4.3 | Includes patched [image optimization](https://github.com/advisories/GHSA-2464-fhr4-w9xw) and [cache-component](https://github.com/advisories/GHSA-673q-mjm6-r5xr) advisories. |
| sharp | 0.35.4 | 0.35.5 | Patched [librsvg vulnerability](https://github.com/advisories/GHSA-wq5f-xc86-pv6w); local runtime reports librsvg 2.63.2. |
| source-map-js | 1.2.1 | 1.2.2 | Patched [indexed-source-map resource exhaustion](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). |
| Zod | 4.4.2 | 4.6.7 | Includes the fix for [collection-validation memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). |

`eslint-config-next` was aligned to 16.4.3. The MCP SDK remains 1.32.2. Only the two framework pins changed in `package.json`; compatible transitive updates and their platform binaries are recorded in `package-lock.json`. No forced major upgrade, unrestricted automatic audit fix, application behavior change or database migration was used. Package installation scripts were disabled.

Fresh `npm audit --omit=dev` and full `npm audit` both returned **zero known vulnerabilities**, with successful registry responses and exit code 0. These results describe npm's advisory data at the time of this audit and do not establish absence of undiscovered vulnerabilities.

Post-update verification passed: all 281 tests, TypeScript, scoped lint, isolated Next.js 16.4.3 webpack production build (34 static pages), and the synthetic service-key scan of all 78 browser artifacts. A native sharp encode/decode check returned a valid 2-by-2 image using sharp 0.35.5/librsvg 2.63.2.

The existing browser smoke suite also passed all **14 cases** with the patched dependencies and the minimized MCP response contract. It exercises the actual Next UI, native browser OAuth approval/revocation, separate synthetic accounts, PGlite SQL, cookie-free bearer MCP administration, result receipt replay, owner action preview/commit, and administrator delegation/removal. Its assertions now use public MCP fields instead of expecting the deliberately removed raw storage snapshot.

The first isolated browser attempt failed before any case because Turbopack cannot resolve the external dependency junction outside its workspace root. The successful run uses webpack in the isolated runner copy, matching the production-build bundler; the active application's runner default is unchanged. The browser/Node network guards block nonlocal requests. These checks do not constitute hosted Google login or a real Claude/ChatGPT connection.

Evidence: `verification-local/security-dependencies-before-2026-10-29.json`, `security-dependencies-after-2026-10-29.json`, `security-dependencies-all-2026-10-29.json`, `security-dependency-version-changes-2026-10-29.json`, `security-dependencies-browser-evidence-2026-10-29.json`, and the `security-dependencies-{tests,types,lint,build,client-bundle,image-runtime,browser}-2026-10-29.log` files. The before-lock snapshot preserves the prior dependency state. The current source/lock inventory is in `security-source-manifest-2026-10-29.json`.

## Limits and outstanding work

1. These source changes are not live. A separately authorized production release and authenticated acceptance with dedicated test accounts are still required. No database migration is needed for this patch.
2. The initial audit was blocked by sandbox networking and automatic disclosure review. The user's subsequent approval resolved that blocker; both production and full advisory audits now pass after the targeted updates. Advisory coverage is limited to known published issues and must be refreshed when dependencies change.
3. Tests use local PGlite and synthetic users/tokens. They do not verify production grants, live PostgreSQL configuration, hosting/firewall settings, exposed source maps, backups, incident history or real external client behavior.
4. The per-account limiter begins after credential verification. Anonymous floods, distributed load, slow bodies and hosting-wide denial of service require edge/infrastructure controls. No production load attack was performed.
5. Server-held administrative credentials remain a host/process risk. The output tripwire is supplemental and cannot recognize every secret format. Public web application metadata is outside the MCP projection; the application cannot promise that its entire technology stack is undiscoverable.
6. A compromised client with a valid owner grant can exercise owner permissions. Preview hashes protect against changed proposals; client-supplied confirmation flags do not independently attest a human click. Host-model prompt-injection behavior was not certified.
7. The public tournament read shape changes from storage snapshots to product fields. Connected assistants should refresh tool discovery and follow `match_page.next_offset`. Product names and authorized roster references intentionally remain visible for tournament operation.

## Re-running verification

From `app/`, run `npm test`, `npx tsc --noEmit`, and scoped ESLint on `lib/tournament-builder/mcp*.ts`, `app/api/mcp/route.ts`, `tests/tournament-builder/mcp*.test.ts`, and `scripts/tournament-builder/verify-client-secrets.mjs`. Build from a fresh isolated source copy with installed dependencies and telemetry disabled. The bundle scanner accepts the built `.next/static` path and reads candidate private values only from process environment; it never prints their names or values.

Source hashes and the security-change file inventory are in `verification-local/security-source-manifest-2026-10-29.json`. This inventory is not deployment authorization or a safe whole-file overlay: `mcp-admin.ts` already had pending registration edits, and the response view uses the existing local `resolved-definition.ts` helper. Review these dependencies against the selected release checkpoint. Preserve unrelated registration, graph, legal and documentation changes already present in the shared trees. Do not deploy the whole dirty tree by accident.
