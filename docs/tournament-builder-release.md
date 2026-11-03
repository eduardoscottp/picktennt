# Tournament Builder release and verification

## Final deployed checkpoint — 28 October 2026

Deployment `dpl_B2XtEZgZcQwqKhsdVP7FxJ5MW4e4` is READY at https://app.picktennt.com. Production build/TypeScript passed; 213 automated tests, scoped lint and all 14 isolated browser cases passed. Named migrations001–010 are applied. The guarded009–010 transaction preserved existing data/grants/function security and the user's completed revision43 event. Public OAuth metadata advertises all three scopes and unauthenticated MCP returns the matching401 challenge.

See `docs/evidence/owner-release-2026-10-28.json` and `docs/evidence/owner-admin-browser-local-2026-10-28.json`. Fresh actual Claude owner consent/mutation is a separate user acceptance check; local simulated authentication is not presented as external-client evidence. This checkpoint supersedes older pending release statements below.

## Current release boundary

This feature is implemented in the existing Picktennt Next.js application. It reuses Supabase accounts and the existing tournament, player, team, member, round, match and standings tables. The original checkouts remain unchanged. This isolated branch starts at `d3821bd` and also retains the legal/support pages and publication guard from `origin/master` at `137b5e0`.

Local tests do not prove hosted deployment or actual ChatGPT/Claude account connectivity. The user authorized release on the existing production environment on 28 October, confirming its data is for testing. Production feature variables are configured; database application and deployment evidence are recorded separately. Do not describe the MVP as ready until the acceptance steps below pass on the intended HTTPS environment.

## Configuration

Keep the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and server-only `SUPABASE_SERVICE_ROLE_KEY`. Never put the service key in a browser, assistant configuration, screenshot, test log or repository.

Enable these additional server environment variables only on the intended deployment:

| Variable | Value |
|---|---|
| `TOURNAMENT_BUILDER_ENABLED` | `true` |
| `MCP_ENABLED` | `true` |
| `APP_ORIGIN` | Exact HTTPS origin, with no trailing slash or path |

The MCP URL is `${APP_ORIGIN}/api/mcp`. OAuth discovery, registration, consent, token exchange and revocation use the same origin. Existing Picktennt login authenticates consent. Connector credentials are separate opaque tokens; Supabase login tokens are never issued to ChatGPT or Claude. The existing Supabase OAuth server does not need to be enabled.

## Database changes

Named migration history for this feature (never blanket-push unrelated files):

| Migration | Purpose | Status at this checkpoint |
|---|---|---|
|001 tournament_builder | Modular contracts, commands, audit and legacy guards | Previously applied; see BUILD-STATUS |
|002 tournament_connector_oauth | Isolated opaque OAuth/PKCE | Previously applied |
|003 tournament_admin_rest_override | Historical explicit rest exception | Previously applied; superseded by 004 |
|004 remove_tournament_rest_constraint | No elapsed-rest gate | Previously applied |
|005 tournament_guest_entries | Historical guest metadata | Previously applied; new enrollment disabled by 006 |
|006 require_picktennt_accounts | Reject new guest enrollment | Previously applied |
|007 tournament_registered_entries | Existing-profile administrator admission | Previously applied |
|008 tournament_connector_administration | Fresh scoped routine administration | Previously applied |
|009 tournament_connector_owner_actions | Fresh owner scope and reviewed owner actions | Database applied; application release pending |
|010 tournament_administrator_management | Audited owner add/remove administrator commands | Database applied; application release pending |

Latest recorded application checkpoint: dpl_BzEPQxDKYwS4pANqkA9c7FfJqY9S. Production database migrations 009/010 are applied with preserved row counts, existing grants, function security and completed user event revision 43; application deployment and live owner-tool/browser acceptance are pending. Evidence: app/docs/evidence/owner-release-2026-10-28.json.

Inspect the current target catalog before applying them. Do not run a blanket migration push: older migration files are not a complete reflection of the deployed shared Android/Wear database. Existing events default to the legacy engine. Modular events require server command transactions; direct legacy writes are blocked. OAuth credentials are stored as digests in a private schema.

The first migration replaces global tournament-name uniqueness with uniqueness for legacy tournaments. Disabling the UI is not a schema rollback. Never drop the new tables or attempt to restore global uniqueness after users have created modular tournaments without a separate data-preservation plan.

The existing Vercel preview environment currently shares production Supabase variables. A preview URL alone does not isolate test data. No paid staging resource has been approved. Use the existing production environment as explicitly authorized. No paid staging resource is required or authorized.

## Local verification

Run from the app repository:

```powershell
npm ci
npm test
npx tsc --noEmit
npx --yes --package=node@24 node node_modules/next/dist/bin/next build --webpack
```

Use Node 24, matching the current Vercel runtime. The existing local Node 26/Turbopack combination failed starting its CSS worker; the Node 24 webpack build succeeded before later feature integration. Re-run the final integrated build before release.

Tests include strict module definitions, legal scores, round robin and seeded brackets, accepted-score progression, all placements, consent, permissions, revision conflicts, retries, atomic SQL changes and opaque OAuth. PGlite tests use synthetic users. They do not replace hosted multi-connection concurrency, actual Supabase Auth or real assistant-client tests.

Baseline ESLint has two pre-existing errors: the internal anchor in `app/page.tsx` and a synchronous effect update in `components/tournament/admin-upload-dupr.tsx`. Keep new-source lint clean and report the baseline separately.

## Hosted acceptance gate

1. Verify the deployment and database references, named migration results, feature flags, HTTPS origin and existing Google login/callback.
2. In the chosen actual Claude account, add the MCP URL and authenticate with Picktennt. Approve draft, routine administrator and owner scopes only as needed; they are separate explicit grants. Verify denial, old-grant nonexpansion and revocation. ChatGPT onboarding is a follow-up, not a second-client gate.
3. Ask the assistant to create a tournament. It asks for missing facts, shows the supported contract and returns review information. Draft tools do not enroll players. Authorized routine tools may enroll only verified existing profiles; owner tools require current ownership, an exact preview and explicit confirmation.
4. Review and publish natively or through the current confirmed owner action. Join with actual consenting test accounts, or explicitly enroll existing profiles administratively without fabricating consent. Close registration, review/lock the roster and activate the event.
5. Enter completed scores directly, with no Start game or elapsed-rest wait; confirm from the actual opposing entry or use administrator Save & Validate. Test reviewed owner cancellation/reopening and administrator add/remove on explicit test events. Refresh/retry uncertain responses without duplicate writes.
6. Finish the eight-team fixture: 28 round-robin games, two semifinals and a final. Verify champion, second, shared third when bronze is disabled, and every remaining placement. With bronze enabled, verify third and fourth separately.
7. Revoke the AI connection after publication. Website scoring and tournament completion must continue; the revoked connector must immediately lose access.
8. Run the correction, withdrawal, tie, concurrency and legacy/native regression cases before calling the release complete.

Save actual test evidence and remaining limitations. A mock client, successful build or uploaded deployment is not proof of a connected assistant journey.

## Evidence status and current acceptance

The actual chosen Claude account created draft 549b556b-3533-5b64-a89a-b4552294fa2b and later confirmed administrator-tool discovery. The completed user event is preserved at revision 43. Local browser/PGlite and isolated bearer-only HTTP MCP→SQL tests establish additional behavior but are not actual Claude-issued mutations. Record the final owner-scope release and chosen-client mutation separately.

All new enrollment references real profiles. Preserve DUPR linkage; no remote DUPR verification, identifier fabrication or new modular export is claimed. Historical guest records and prior completed results remain unchanged. See the root MVP-REMAINING-AUDIT.md for the point-in-time gap list and record subsequent fixes/tests/live checks in BUILD-STATUS.md.
