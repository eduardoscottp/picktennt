# Build status and evidence

Updated: 29 October 2026

## Local update: required setup fields and team labels (not deployed)

The draft page now exposes the missing event, registration and scheduling inputs with required markers, red inline feedback and links from validation messages to the fields. Date/time controls use the event timezone. Partial drafts remain savable; final approval remains gated on saving and validating the completed definition. Visible seed placeholders are labeled Team N. Existing stored seed references and tournament rules are preserved.

Verification: 257 automated tests, TypeScript and scoped lint passed. A hydrated local Chrome fixture completed the exact missing-field case, saved through the real command planner and opened registration after explicit review; desktop/mobile layout and zero page errors were verified. See [UI evidence and screenshots](../docs/evidence/draft-required-fields-2026-10-29.md). No new full production build, live deployment or production-data change is claimed for this refinement.

## Local update: registration before fixtures (not deployed)

The approved flow is implemented locally: incomplete graph decisions no longer prevent saving supported scheduling values; registration can open with planned group slots and zero players; minimum capacity can be below maximum; actual group assignments are reviewed before fixtures are generated. Finalization records completed graph connections and slot occupancy with the locked roster while preserving the immutable published plan. Empty slots generate no group games.

Verification: 252 automated tests passed, scoped ESLint passed, and the isolated Next.js webpack production build with TypeScript passed. The SQL journey completed 10 doubles teams in groups of 3/3/2/2 through 11 matches and placements, preserving published rules and fencing stale writes. See [local evidence and MCP contract](../docs/evidence/registration-planning-2026-10-28.md).

No production deployment, migration, tournament edit or grant change was made. Automatic ranking of runners-up across groups remains unsupported and is disclosed as pending; generation still requires a complete supported qualification graph. The live deployment described below remains the prior release.

## Released extension: composable version 2 blocks

Implemented after the deployed version 1 MVP described below. See [COMPOSABLE-BLOCKS.md](COMPOSABLE-BLOCKS.md), [approved design](docs/superpowers/specs/2026-10-28-composable-tournaments-design.md), [implementation plan](docs/superpowers/plans/2026-10-28-composable-tournaments.md) and [four-group definition](examples/four-groups-definition.json).

- **Source boundary:** deployed from a feature-only snapshot based on application checkpoint `51adade`, with exactly 17 tournament feature files overlaid. Pre-existing AGENTS, legal, config, session and one-off script changes were excluded and preserved. Source changes remain uncommitted; no push or merge was performed.
- **Behavior:** independent round-robin groups, cross-play and match blocks consume explicit seed, rank, winner or loser sources. Cross-play generates every side-A-versus-side-B game without same-side games. Explicit matches support seeded internal qualifiers such as ranks 9–1, 8–2, 7–3 and 6–4, routing those four winners forward. Four groups of four feed semifinals and final: 27 matches. Top-two cross-seeding, further round-robin/consolation branches and optional bronze are supported. MCP discovery/draft schemas and website views expose the same model. Version 1 meaning remains unchanged.
- **Automated:** `npm test`: **244 passed, zero failed**. Includes all prior tests plus graph contract, runtime, persisted command, UI and storage coverage. `npx tsc --noEmit` and scoped ESLint passed.
- **Production build and release:** local Next.js webpack build passed using bundled Node 24.19.0, including compilation, TypeScript and all 34 static pages. Feature-only production deployment `dpl_AvaoBnrxSDK1cbA3EkataXPdTHSR` built in 43 seconds, was smoke-tested before promotion, and is READY at `https://app.picktennt.com`. Public OAuth metadata returns 200; unauthenticated MCP returns the expected 401 Bearer challenge with draft/admin/owner scopes. The first post-promotion scan found zero runtime errors and zero 5xx requests.
- **Storage evidence:** local PostgreSQL/PGlite command RPC journey with 32 actual local Auth/profile records, 16 doubles entries, 27 accepted results, four separate standings tables and final placements. Stale mutations roll back without new receipts. Global round numbering satisfies the existing SQL uniqueness constraint while `logical_wave` retains parallel scheduling.
- **Edge cases:** accepted results alone advance; rank ties require revision-bound draws; incomplete-group withdrawal clears affected standings; unavailable completed ranks propagate audited empty outcomes; automatic outcomes update the block's input revision; corrections with unchanged output entrants preserve downstream games, while changed started dependents require reviewed replay.
- **Browser rendering:** [six desktop/mobile checks](../docs/evidence/composable-browser-2026-10-28.md) passed with production CSS in installed Chrome; [screenshot](../docs/evidence/composable-browser-2026-10-28.png). This is static component rendering evidence, not hydrated interactions, real authentication or actual Claude use.
- **Database/release boundary:** no new migration was required or applied. No production schema, event or grant changed. The live MCP now serves version 2 discovery and draft contracts; existing grants retain their scopes. Fresh authenticated creation through actual Claude remains the user acceptance check.
- **Bounds:** exact 2–16-entry capacity, at most 64 nodes, shared match/ranking policy, composition via MCP/JSON. No drag-and-drop editor or per-block policy overrides. Scheduling is conservative where future entrants are unknown.

The remainder of this file records the prior deployed version 1 release and its historical ledger.

## Overall state

- Documentation: complete for implementation handoff; cross-document checks recorded below.
- Implementation model: user authorized the proposed allocation; Sol agents handling bounded implementation.
- Application implementation: final owner/administrator release deployed from the isolated app/ checkout to https://app.picktennt.com; deployment `dpl_B2XtEZgZcQwqKhsdVP7FxJ5MW4e4` is READY.
- Final automated verification: 213 tests passed, TypeScript passed, scoped lint passed, and the production build passed. All 14 isolated browser acceptance cases passed, including native administrator management and native owner consent through cookie-free HTTP MCP/SQL mutations and revocation.
- Hosted synthetic acceptance: passed real native Auth, OAuth/MCP, ten games with all four placements, connector revocation and separate parallel-request concurrency checks; sanitized evidence is linked below.
- Actual Claude evidence: the user connected Claude, created the four-player draft and later confirmed administrator tools appear. The user completed that tournament on the website; all ten accepted results and four final places were read back. A fresh actual Claude administrator/owner mutation remains a separately labeled live acceptance check. Actual ChatGPT onboarding is an optional follow-up because the selected goal is ChatGPT **or** Claude and the user chose Claude.
- Production migration/deployment: named migrations 001–010 are live. The 009–010 transaction preserved all checked row counts, existing grant records, function security settings and the completed user event at revision 43. Existing grants do not gain new owner authority automatically.

Objective remains a completed, verified MVP. User authorized implementation and end-to-end testing on 28 October 2026.

### Final release evidence

- [Database preservation](../docs/evidence/owner-release-2026-10-28.json).
- [Fourteen isolated browser cases](../docs/evidence/owner-admin-browser-local-2026-10-28.json). Authentication and external callback are simulated locally; this does not claim actual Claude owner-tool use.
- Public live checks: both OAuth metadata endpoints return 200 and advertise draft/admin/owner scopes; unauthenticated MCP returns the expected 401 challenge with all three scopes. Build, Admin and Standings routes redirect unauthenticated visitors to the matching login destination.
- Actual selected-client journey already recorded: Claude connected and created the draft; the user entered the tournament's scores in Picktennt; all ten accepted matches and four final places were read back from production. Fresh owner-scope consent/tool discovery and a new actual Claude owner mutation remain external acceptance checks, distinct from the completed core journey.
- [Issue board](ISSUE-BOARD.md) and [CSV export](ISSUE-BOARD.csv) track delivered work and remaining follow-ups. GitHub publication requires restoring the existing invalid CLI authentication; no external board is claimed.
- Application checkpoint: commit `51adadeb181af6cdb3242bac3910308e27453aa0` on `codex/tournament-builder-mvp`, containing exactly 128 audited feature files. Unrelated legal/config/agent changes and one-off production scripts remain unstaged. The initial push was rejected pending explicit authorization; the user then approved that exact repository/branch. The push succeeded after a transient network timeout, and `git ls-remote` verified the identical full SHA. No merge was performed.

Everything below is a chronological evidence ledger. Older counts, scope limits and pending statuses describe their recorded release, and are superseded by this final checkpoint where they differ.

## Baseline known from the preceding inspection

| Item | Evidence |
|---|---|
| Inspected source | C:/Users/Eduardo/picktennt-backend |
| Observed branch / HEAD | codex/session-games / d3821bd |
| Existing changes to preserve | scripts/test-session-games.mjs; untracked supabase/migrations/013_session_games_v2.sql; Supabase temporary files |
| Second checkout | C:/Users/Eduardo/coding/picktennt; different package/migration inventory |
| Authoritative deployed commit | Not verified; T00 will establish |
| Applied production migrations / RLS | Read-only catalog captured in verification-local; no production writes |
| Isolated implementation checkout | app/ isolated clone; codex/tournament-builder-mvp based on d3821bd |
| Isolated test database | PGlite local PostgreSQL fixtures; hosted staging not approved or created |

Do not promote observed local files or historical notes to production evidence. Recheck dirty state before implementation.

## Task ledger

| Task | Status | Evidence / next action |
|---|---|---|
| T00 Baseline/isolation | In progress | Establish source/deployment/database mapping |
| T01 Contracts/client feasibility | Not started | Docs prepared; verify against baseline and actual accounts |
| T02 Schema/catalog/validator | Locally verified | Strict definitions and module compositions tested |
| T03 Storage/atomicity/guards | Locally verified | PGlite role, transaction, authorization and guard tests pass; hosted concurrency pending |
| T04 Commands | Locally verified | Shared website and connector command boundary; full SQL singles and doubles journeys |
| T05 Modules/complete workflow | Locally verified | Eight-team 31-game fixture and all placements pass |
| T06 Corrections/withdrawals | Locally verified | 14 boundary tests and real SQL selective replay and withdrawal cases pass |
| T07 Website | Browser verification | Review, consent, roster, scoring, recovery and placements implemented |
| T08 MCP | Protocol verified locally | Nine draft tools and opaque OAuth; actual assistant account acceptance pending |
| T09 Integrated verification | Not started | Full staging acceptance + reviews |
| T10 Release | Authorized and in progress | Existing Vercel/Supabase; only migrations 001 and 002; no paid staging |

## Evidence format to add after each task

For each completed task, record date, source path/commit or exact local patch, changed files, environment, test commands, actual results, reviewer findings and unresolved concerns. Link logs only when they contain no secrets. Distinguish unit, database integration, browser, actual connector and production results.

## Documentation verification

This section is for document/link/fixture checks only. It does not satisfy application acceptance criteria.

- Nine Markdown documents and one example JSON saved in this project folder.
- Local Markdown links checked: zero broken targets.
- All seven versioned module contracts present.
- All 14 PRD requirement IDs represented in the acceptance coverage matrix.
- Example JSON parses; its seven-node chain and links match the approved composition.
- Eight-team fixture arithmetic checked: 28 round-robin matches + 2 semifinals + 1 final = 31.
- No unresolved TODO/TBD/FIXME markers in the documentation.
- Focused independent module/contract review identified schema-limit, error-taxonomy, receipt-replay and publication-hash inconsistencies. Coordinator corrected these and aligned proposed source/test paths and published-definition policy.
- Documentation work used one focused Sol agent for module contracts and read-only cross-document review. No implementation agents or application tests were run.


## Implementation checkpoint: 28 October

- Isolated source: app/, branch codex/tournament-builder-mvp, base d3821bd. Original shared checkouts preserved.
- Local tests: npm test reports 94 passing tests; npx tsc --noEmit passes. Tests include the 31-match eight-team flow through actual local PostgreSQL commands, singles completion, operation replay, role guards, safe roster reads, opaque OAuth consent/exchange/refresh/revocation and MCP protocol handling.
- Baseline build passed using Node 24 and webpack, matching the hosted Node major. Default Turbopack on local Node 26 failed starting its CSS process; no framework upgrade was made.
- Baseline lint has two existing errors: app/page.tsx internal anchor and components/tournament/admin-upload-dupr.tsx setState-in-effect. Scoped new-source lint is checked separately.
- New migrations are local only: 202610280001_tournament_builder.sql and 202610280002_tournament_connector_oauth.sql. Do not blanket-push unrelated migrations.
- Website and correction/withdrawal integration are in progress. Passing core tests does not establish finished UI or actual ChatGPT/Claude account connectivity.
- Authentication decision: see AUTH-INTEGRATION.md. Reuse existing Picktennt login for consent; issue separate connector-only opaque tokens. Do not enable Supabase OAuth on production as part of this implementation.
- Hosting/database access confirmed read-only. Existing Vercel previews share production database. User asked why staging was needed; no paid environment approved, provisioned or purchased. Local work continues.
- Release flags: TOURNAMENT_BUILDER_ENABLED=true, MCP_ENABLED=true, APP_ORIGIN set to the exact HTTPS website origin. Existing Supabase environment names are reused. Never commit real environment values.

## Authorized production release, 28 October

- User explicitly chose the existing production environment and confirmed its data is testing data; no paid staging was created.
- Applied only 202610280001 and 202610280002 in one transaction, recording named migration history. All ten existing table row counts preserved; 46 existing tournaments remain legacy/revision 0.
- Deployed and promoted Vercel dpl_2UA9NUZnG7KUQBhH6a5UgvXkFXHU to https://app.picktennt.com. Hosted Next.js production build and TypeScript passed.
- Public login, iOS privacy and support return 200. Both OAuth metadata endpoints return 200 with the canonical origin; unauthenticated MCP returns 401 with its resource metadata challenge.
- Browser verification found and fixed the consent CSP blocking external callback redirects. Local browser tournament creation, publication, separate participant consents, score receipt recovery, opponent confirmation and placements passed before the callback harness adjustment.
- Real ChatGPT/Claude account connection remains pending; hosted synthetic-account tournament and concurrency checks are in progress. Do not equate deployment with completed acceptance.

## Local browser acceptance completed

- Six browser cases pass: create/review/publish; separate participant consents; committed score recovery after an injected interrupted response; opponent confirmation and final places; native OAuth consent with validated external 303 callback and token revocation; shared-third rendering fixture.
- Evidence: app/test-results/tournament-smoke/evidence.json. Next/Chrome/test servers stopped after completion.
- Actual UI used local PGlite and simulated Supabase Auth/REST. The shared-third case is a read-only synthetic rendering fixture, not a completed four-player browser tournament. Neither proves a real Google or Claude session.

## Hosted synthetic acceptance completed, 28 October 16:03 UTC

- Environment: the explicitly authorized existing Supabase project `qmiljmxnnryhuaudpuff` and deployed `https://app.picktennt.com`, Vercel deployment `dpl_2UA9NUZnG7KUQBhH6a5UgvXkFXHU`.
- Created exactly four explicitly labeled synthetic accounts. Each used its own real Supabase native session and explicitly consented to its own singles entry. No existing person's consent was impersonated.
- Actual hosted OAuth/MCP protocol passed: dynamic registration of an explicitly named synthetic client; native owner consent; S256 PKCE code exchange; single-use code rejection; refresh rotation; MCP initialization; all nine draft tools and seven modules; incomplete draft creation, complete update, validation, preview, review link and original operation receipt.
- The owner published the exact reviewed definition through the native website API. Native connection revocation then immediately denied the revoked MCP receipt replay with HTTP 401 and rejected refresh with `invalid_grant`. All subsequent tournament play used the native website API.
- Completed tournament [77cd410a-c69a-56b0-a88a-b058c6bb007e](https://app.picktennt.com/tournaments/77cd410a-c69a-56b0-a88a-b058c6bb007e/builder): four singles entries, two courts, six full round-robin games, two semifinals, gold and bronze. All ten games were started by a participant, submitted by one actual entry and confirmed by its actual opponent. Synthetic A/B/C/D finished first/second/third/fourth. Round-robin UUIDs were preserved, provisional scores did not count officially, result version remained 1, and replaying the completed confirmation returned its original receipt without another completion.
- Separate real parallel HTTP requests passed on synthetic event `829f05ae-9ba8-5e56-a7ca-07c42ff34ba3`: identical-operation create race; one winner for same-revision updates; one admission winner for the last slot; losing admission retained pending with `CAPACITY_FULL` on a fresh retry; ordinary authenticated role denied execution of trusted effects; one winner for parallel court starts; fresh second start rejected with `COURT_BUSY`. Owner cancellation closed that concurrency event while retaining its history.
- Cleanup signed out and disabled only the four run-marker-verified synthetic accounts; synthetic connector access was revoked. Completed results, canceled test events, profiles and operation history remain as evidence. An initial harness-only empty-401 parsing failure left one additional own synthetic event canceled; the same four accounts were reused after the parser fix. No credentials, passwords, cookies, authorization codes or tokens were saved or printed.
- Reproducible harness: `app/scripts/tournament-builder/hosted-acceptance.mjs`, explicit `--run --project-ref` checks, optional verified same-account resume, and in-memory management-key retrieval. Vercel environment export could not reveal protected production values, so the existing authorized Supabase management session supplied keys only in process memory. No credential file was created.
- Sanitized evidence: [app/docs/evidence/hosted-acceptance-2026-10-28.json](../docs/evidence/hosted-acceptance-2026-10-28.json). Harness guard/response tests: 3 passed; TypeScript and scoped harness lint passed.
- Limits remain explicit: this was a real hosted synthetic OAuth/MCP client, not an actual ChatGPT or Claude account journey. The hosted event used four singles and zero configured rest; full eight-team doubles and timed-rest cases have separate local PostgreSQL/browser evidence. These hosted checks do not complete all MVP acceptance requirements or mark the overall objective complete.

## Actual Claude connection compatibility follow-up

- User chose Claude. Its first registration attempt reached /oauth/register and returned HTTP 400 (15:57 UTC); this was not a network or deployment-protection failure.
- Fixed RFC 7591 handling of unknown client metadata: discard extensions rather than reject them, while retaining strict public-PKCE, callback, grant and scope validation. Rejection diagnostics log classifications only, never request bodies or credentials.
- Deployed dpl_FbX7CQgG7DB7LHoZhmhWaBBfE6fD to app.picktennt.com. Hosted build passed and a registration request with extra application_type metadata returned 201.
- User asked to retry. Actual Claude sign-in/tool discovery remains pending; the original rejected metadata field has not been observed.

- Final integrated local suite after the compatibility patch: 124/124 passed. The deployed production build includes a successful TypeScript check.

## Native browser consent fix, 28 October

- Actual Claude progressed through registration but browser consent returned 403. A native Chrome form POST reproduced the exact cause: the HTML Referrer-Policy no-referrer made Origin null while the CSRF cookie was present.
- Changed only OAuth HTML to Referrer-Policy same-origin. Token/JSON responses retain no-referrer. Exact origin, matching cookie/proof, native user binding and expiry checks remain enforced.
- Native browser regression (without Playwright request interception) proves old-policy consent and revocation return 403, while both fixed product forms return 303 with the correct Origin. Null-origin requests with matching cookie/proof are still rejected.
- 22 scoped authentication tests and scoped lint passed. Production build and TypeScript passed. Deployment dpl_3s5TEaFwazNW2Qsw71tZpbyGBL9G is live at https://app.picktennt.com.
- Browser evidence: app/test-results/oauth-consent-origin/evidence.json. Earlier intercepted browser consent evidence did not cover native Origin behavior; this regression closes that testing gap.
- User asked to start a fresh Claude connection. Actual tool discovery and draft creation through Claude are still pending.
## Actual Claude draft and policy discovery repair, 28 October

- User confirmed Claude connected and tools appeared, then supplied actual Claude-created draft 549b556b-3533-5b64-a89a-b4552294fa2b. Creation exposed missing policy vocabulary in MCP discovery and nonactionable enum errors.
- Shared validator rules now generate full and partial definition JSON schemas. get_capabilities returns exact policy values, meanings and participant-consent boundaries; create/update advertise the partial schema. Missing/invalid fields include allowed values and constraints. Tests build all supported compositions from advertised schemas without private fixtures.
- Added owner-only draft ranking/confirmation/correction controls using the raw saved partial definition and existing revision/recovery save flow. No implicit choices or publication.
- Administratively repaired only three missing fields on the user-requested draft through executeCommand: ranking.order=[wins_desc,differential_desc,points_for_desc], confirmation=opponent_or_admin_v1, correction=impact_review_void_and_replay_v1. Receipt ebbe5be9-79dd-4305-858c-8e1c1869a5fd advances revision1 to2. Canonical readback validates the exact intended changes and preserves all other facts. This was an authorized administrative repair, not a browser-owner action.
- Draft remains unpublished. Venue TBD and estimated 15:00 end preserved. Actual entries, participants, teams and matches remain zero; Claude's pre-registration claim was incorrect.
- Integrated suite133/133 passes, TypeScript and scoped lint pass. Production build passed and dpl_7pxr75yKBHoExg3NnaR3CPVrLsqj is live at app.picktennt.com.
- Evidence: verification-local/2026-10-28-claude-draft-549b556b-repair-result.json and after.json. User should reload the existing draft and ask Claude to call get_capabilities again before subsequent edits.
## October 28 — administrator scoring usability release
- Production deployment dpl_J6kKYDAGKqs2b3EGZzr6wQRFdhtz, aliased app.picktennt.com; hosted build and TypeScript passed.
- All 145 automated tests pass; scoped lint and local TypeScript pass.
- Applied only migration003 (administrator rest override), with exact function source guard and unchanged 14 table counts and complete user-event snapshot at application time.
- Familiar Save & Validate action, explicit required reason, per-match errors, stage/feeder labels, unique inputs, refreshed score forms, administrator reasoned rest override.
- Full legacy tournament-view reuse, supported administrator guest enrollment and administrator OAuth/MCP tools remain incomplete; see ADMIN-ASSISTANT-REQUIREMENTS.md.
- Live authenticated browser verification: deployed UI shows Save & Validate, explicit rest override, distinct semifinal/final/third-place labels. Started both semifinals using website controls, each visibly IN PROGRESS; no playoff scores entered. Screenshot verification-local/admin-scoring-live.png.

## October 28 — normal tournament navigation released
- Production deployment dpl_JC3Fh5gPuUTmDM3sLXoXvY3SA4tf is READY and aliased to app.picktennt.com; hosted build and TypeScript passed.
- Published modular events now use Overview, Matches, Standings and Admin routes with the existing desktop/mobile tournament navigation. Published builder bookmarks redirect to Overview; drafts retain the builder.
- 158 automated tests, TypeScript and scoped lint passed. All eight local browser scenarios passed, including scoring recovery and final placements; evidence: app/docs/evidence/normal-tournament-routes-local-2026-10-28.json.
- Live authenticated browser checks verified the builder redirect and all four focused views. Matches displays administrator Save & Validate controls for both in-progress semifinals. Existing legacy tournament overview also rendered successfully.
- Read-only production verification: user tournament remains active at revision36. No scores, entries, definition, or database schema changed in this release.
- Remaining: supported administrator guest enrollment and expanded assistant OAuth/MCP administrator tools. This release reuses navigation and normal routes, not every legacy visual component, and does not mark the full MVP complete.

## October 28 — one-click administrator validation
- Fixed the remaining UI blocker: ordinary played results no longer require typing a reason. Save & Validate records an automatic administrator audit note; an already saved provisional result shows Validate saved score. Administrator players no longer see the competing provisional-submit action.
- Explicit explanations remain mandatory for disputed results, retirements, walkovers and no contests. Backend authorization, legal score checks, rest and bracket dependency rules are unchanged.
- The user-entered semifinal1 score (sales 11–2 Eduardo) was validated through the authenticated website. Winner sales propagated to the final and Eduardo to the third-place match. No score was invented for semifinal2.
- All159 automated tests passed; TypeScript, scoped lint, and nine local browser cases passed. The browser regression verifies automatic audit note payload, validation of a player-submitted score, interrupted-response recovery and final placements. Evidence: app/docs/evidence/admin-one-click-validation-local-2026-10-28.json.
- Deployment dpl_FrcxJbwfiZoDbBNhNC4yenY2eeZc is READY and aliased to app.picktennt.com; hosted build/TypeScript passed. Live browser verified optional note and Save & Validate on semifinal2, and semifinal1 VALIDATED 11–2. Screenshot: verification-local/admin-validation-live.png. No migration required.

## October 28 — elapsed-rest constraint removed at organizer request
- Removed elapsed-rest enforcement from the modular command planner and database command function. Starts and scoring no longer require waiting after a previous game. Court/player occupancy, feeder validation, roles and legal scoring remain enforced.
- Removed rest override controls and the new-draft rest input; new website drafts store zero for compatibility. Existing published definition values remain historical and are no longer enforced. Overview explicitly shows no enforced rest.
- Applied only migration202610280004_remove_tournament_rest_constraint.sql. Exact function-base guard and transaction verification preserved function owner/ACL/security config and the complete current event snapshot. Readback: event revision39 and hash a162f030eec6fb3e8c06ed6936144f87 unchanged; function source md5 5deef1276492a38e6c422c2fb12e8071; migration004 recorded.
- All159 tests pass, including real SQL immediate starts after completion/voiding with nonzero saved rest. TypeScript/scoped lint and nine local browser checks passed. Evidence: app/docs/evidence/no-rest-browser-local-2026-10-28.json.
- Production deployment dpl_5W6zw29mkGqfHHGBxuMqjvDPc6hW READY at app.picktennt.com, build/TypeScript passed. Live authenticated match view shows both semifinals validated and Final/Third-place Start match controls with no waiting period or override UI. No match was started or scored by this release. Screenshot verification-local/no-rest-live.png.

## October 28 — actual user tournament completed; direct score entry
- Read-only API and authenticated Standings verified the user's event COMPLETED after their own final/bronze entry. Final sales11–2 Test Player4; bronze Eduardo11–0 Test Player3. All placements:1 sales,2 Test Player4,3 Eduardo,4 Test Player3. Screenshot verification-local/completed-tournament-placements.png.
- Removed the separate Start game button and scheduled-match score submission restriction. Administrator Save & Validate accepts scheduled resolved eligible fixtures; participant submission still needs opposing confirmation/admin validation. No physical start timestamp is fabricated.
- Updated correction normalization and playoff-start detection to recognize accepted results without explicit start timestamps, retaining impact/reopen safeguards.
- 160 automated tests passed; scoped regression additionally verifies a directly saved completed result remains correctable. TypeScript/scoped lint passed; nine local browser checks verify direct scheduled-game score entry through SQL and final placements. Evidence app/docs/evidence/direct-score-browser-local-2026-10-28.json. No migration or user event mutation required.
- Released as dpl_7WPt326nQDvS22k5w1JKSYPTRxdp, READY and aliased app.picktennt.com. Hosted production build/TypeScript passed. Live Standings reloaded after release and still shows COMPLETED and all four final placements unchanged.

## October 28 — administrator guest enrollment
- Added Admin-page registration of named singles/fixed-doubles guest entries without email, authentication accounts, profiles, team-member consent or participant permissions. Names have generated tournament-only UUIDs bound to the published definition; normal operation audit and roster revision are reused.
- Runtime/correction roster identity includes guest UUIDs, and SQL explicit-start occupancy also recognizes a shared guest entry. Completed/locked rosters cannot accept new guests through this command.
- Applied only migration005_tournament_guest_entries. Exact base source and replacement guards; all14 table counts unchanged; existing completed event revision43 and all facts preserved except new empty guest column defaults. Command function ACL/owner/security config preserved; elapsed-rest removal retained. Result source md5 5d566897d10aa3516f3e783aa2db5965.
- All172 automated tests passed. Ten local browser cases passed, including real Admin-form guest enrollment, match generation, direct scoring and final placements. SQL tests cover singles/doubles guests, no account creation, replay, capacity/CAS, forged metadata/memberships, roles, same-entry occupancy and exact definition binding. TypeScript/scoped lint passed. Evidence app/docs/evidence/guest-enrollment-browser-local-2026-10-28.json.
- This does not expand Claude/ChatGPT draft-only permissions. Wider administrator OAuth/MCP tools remain outstanding.
- Production deployment dpl_Av5PSqsFvRZUfwpR3W2cBCiNrrGn is READY and aliased to app.picktennt.com; hosted build/TypeScript passed. Live authenticated completed-event Admin view still renders four original approved entries, shows COMPLETED, and correctly omits guest-add controls after completion. Guest creation itself has local browser + SQL evidence; no production guest entry or account was created for release verification.

## October 28 — real-account enrollment and scoped assistant administration
- User clarified every player must have a real Picktennt account/profile retaining DUPR information. Account-free guest enrollment is removed from UI and blocked by planner/SQL authorization; production guest count remains0. Historical read compatibility and all existing rows are preserved.
- Applied only migration006_require_picktennt_accounts (immediate guest denial),007_tournament_registered_entries (existing profiles with audited administrator admission) and008_tournament_connector_administration (explicit new OAuth permission). Real profile IDs are retained in memberships and tournament-player projections; no identities, consent timestamps or DUPR IDs are fabricated. Existing DUPR linkage/submission checks remain separate.
- Native Admin registration resolves exact existing usernames and enrolls singles/two-account fixed doubles. Administrator admission is labeled separately from personal acceptance and does not create a false invitation. Deadline, capacity, duplicate membership, definition, role and revision checks are enforced again by SQL.
- Fresh optional tournaments:admin consent maps to admin:manage. Existing grants, refresh permissions and client/account role bindings do not implicitly expand. Revocation and role removal stop reads, writes and cached-receipt recovery. Explicit refresh scope changes are rejected; replay still revokes the token family.
- MCP now advertises role/scoped administrator tools for snapshot/player lookup, registered enrollment, registration/lifecycle/fixture locking, result validation/dispute adjudication, ties/courts and correction/withdrawal preview+commit. Structural tool calls require organizer confirmation and current revision/impact hashes. Publishing, cancelling a tournament and reopening completed results remain owner website actions in this increment.
- All192 automated tests passed; TypeScript/scoped lint passed. Twelve local browser cases prove real-username native enrollment and native explicit-admin consent → cookie-free bearer-only HTTP MCP → command planner/SQL → final placements, with idempotent replay. Evidence app/docs/evidence/registered-account-admin-mcp-local-2026-10-28.json. These are local synthetic native sessions, not a fresh external Claude/ChatGPT account test.
- Production migration transaction preserved all14 table counts, complete existing grant rows, all original event facts (apart from new default metadata columns), function ACL/owner/security configuration, and user event revision43. Function source MD5: apply091128457f65c32e39838d8800ab18bb; authorize d9d127279dc69f1097978042a6974774; OAuth3840392019906bb3c3664347831666f7.
- Production deployment dpl_7T6r5GQiZPoDa89RRA6xUyyzAv5c READY at app.picktennt.com; hosted build/TypeScript passed. Live metadata and401challenge advertise draft+admin scopes. Current active Claude grant remains draft-only as intended. Live Standings still shows COMPLETED and final places sales,TestPlayer4,Eduardo,TestPlayer3.
- User asked to reconnect Claude and approve Allow tournament administration; actual external admin-tool discovery/testing remains pending. Do not mark both-client MVP acceptance complete from the local proof.
- Final capability wording follow-up: dpl_BzEPQxDKYwS4pANqkA9c7FfJqY9S READY and aliased app.picktennt.com. Scoped MCP/definition tests8/8 and hosted build/TypeScript passed. Authorized capability discovery now explicitly permits admin_register_players for existing profiles and no longer includes the contradictory draft-only never-enroll instruction. Draft-only capability guidance remains restrictive.
- User subsequently confirmed fresh Claude reconnection and administrator tools appearing (admin_get_tournament/admin_register_players/admin_save_result). This is actual external admin-tool discovery evidence. An actual Claude-issued administrator mutation is not yet reported; local cookie-free HTTP MCP→SQL mutation/replay/final-placement evidence is separate. Actual ChatGPT onboarding remains unverified.

## October 29 — saved tournament revisions and fair scheduling

- Released editable saved tournaments with guarded structural revision before play, separate name/venue edits after play, approved team/player/group changes, capacity and singles/doubles changes, preserved historical stages/fixtures, and impact-preview confirmation. Structural revision locks after any match start, score or outcome.
- Schedule generation remains a deliberate post-registration action. The deterministic allocator interleaves independent groups across available courts and prioritizes waiting entries; local regression evidence covers balanced slots and waiting time.
- Applied only production migration `202610290001_tournament_revisions` after exact 001-010 and function-source preflight. Its transaction preserved all application-table row counts and existing function security metadata. Final readback confirms revision commands and private validator denial for `anon`, `authenticated` and `service_role`.
- Vercel deployment `dpl_1486RDn8KGBZG9vRcoW9ejVoaFzD` is READY and assigned to `https://app.picktennt.com`. Public home/privacy return `200`, protected builder redirects to login, tournament API is reachable, and unauthenticated MCP remains `401`.
- Full pre-release suite: 306 passed; TypeScript, scoped lint, isolated production build, and desktop/mobile browser harness passed. Release-time checks did not mutate a real tournament or execute an external assistant revision.
