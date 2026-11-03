# Tournament MVP issue board — local

Final accepted-scope release recorded 28 October 2026. **Portable local board; no external issues created or published.** Delivery IDs below are local tracking IDs, not GitHub issue numbers.

Final verification: **213 automated tests, TypeScript and scoped lint pass; 14 local browser cases pass.** Production deployment `dpl_B2XtEZgZcQwqKhsdVP7FxJ5MW4e4` is READY at [app.picktennt.com](https://app.picktennt.com). Live metadata advertises all three scopes, anonymous MCP returns 401, and the existing completed user event remains at revision 43.

The accepted connector requirement is **ChatGPT OR Claude**, and the owner selected Claude. Fresh owner-scope Claude connection is a pending user account handoff. ChatGPT onboarding and an additional full-size hosted doubles run are optional follow-ups. Application source is preserved in commit `51adade` (128 audited files), pushed with explicit user approval to `eduardoscottp/picktennt`, branch `codex/tournament-builder-mvp`. Local and remote full SHAs match. No merge or PR is claimed.

CSV export: [ISSUE-BOARD.csv](ISSUE-BOARD.csv). Source plan: [RELEASE-PLAN.md](RELEASE-PLAN.md). Evidence ledger: [BUILD-STATUS.md](BUILD-STATUS.md).

| ID | Kind | Priority | Status | Work item | Requirement |
|---|---|---|---|---|---|
| DEL-01 | Delivered | P1 | Implemented + locally verified | Versioned tournament definitions and actionable validation | R02,R03 |
| DEL-02 | Delivered | P0 | Implemented + hosted foundation verified | Atomic commands, guarded writes and stable receipts | R01,R03,R04,R10 |
| DEL-03 | Delivered | P1 | Implemented + browser verified | Normal Overview/Matches/Standings/Admin navigation | R13 |
| DEL-04 | Delivered | P1 | Implemented + local SQL verified | Round robin, playoffs, ranking and every placement | R05,R07,R08 |
| DEL-05 | Delivered | P1 | Implemented + local SQL/browser verified | Direct score entry and audited result correction | R06,R09 |
| DEL-06 | Delivered | P1 | Implemented + local browser/SQL verified | Real-account administrator enrollment | R04,R10 + current identity policy |
| DEL-07 | Delivered | P0 | Implemented + local HTTP/SQL verified | Explicit scoped administrator OAuth/MCP | R10,R11 |
| DEL-08 | Delivered | P1 | Released: final owner-capable build | Production runtime and completed user tournament | R08,R12,R14 |
| DEL-09 | Delivered | P1 | Implemented, tested and released | Owner actions and administrator management | Current owner-control requirement |
| OWN-01 | MVP acceptance | P1 | Done: local acceptance and production release | Finish owner administrator-management controls | Current owner-control requirement |
| ACC-01 | External user handoff | P2 | Fresh Claude owner-scope check awaits user connection | Fresh Claude owner-scope connection and live user check | Selected Claude handoff; code is released |
| FOL-02 | Proposed follow-up | P2 | Optional; selected client is Claude | Actual ChatGPT onboarding and equivalent draft | Optional expansion of original R11 |
| FOL-03 | Proposed follow-up | P2 | Optional hosted stress/size evidence | Complete full-size hosted doubles acceptance | Optional extension of locally covered F01 |
| ACC-04 | MVP acceptance | P1 | Done for accepted bounded MVP | Final complete acceptance and native/legacy regression matrix | R01,R09,R13,R14 |
| REL-01 | Release gate | P0 | Done; commit 51adade pushed | Preserve implementation in reviewed source commits | R14 |
| REL-02 | Release gate | P0 | Done: exclusions and scoped source audit verified | Exclude credentials and local artifacts | R10,R14 |
| REL-03 | Release gate | P1 | Read-only verification complete | Preserve master legal pages and session source during integration | R01,R14 |
| REL-04 | Release follow-up | P1 | Source pushed; draft PR awaits integration review and CLI authentication | Create remote draft PR after local source freeze | R14 |
| REL-05 | Release gate | P1 | Done: final release wording reconciled | Refresh portable release instructions and evidence pointers | R14 |
| FOL-01 | Proposed follow-up | P2 | Optional; outside MVP scope | Resolve pre-existing repository-wide lint errors separately | Existing baseline quality debt |

## Acceptance and next steps

**DEL-01 — Versioned tournament definitions and actionable validation**

Acceptance: Supported graphs/policies validate; incomplete drafts identify missing decisions; exact review/publication binds current revision.

Evidence: app/lib/tournament-builder/definition-schema.ts; app/tests/tournament-builder/definition-contract.test.ts

Next: Retain final test/source evidence.

**DEL-02 — Atomic commands, guarded writes and stable receipts**

Acceptance: Revision locks, current access checks, rollback, retry/hash conflict and modular direct-write protection hold without changing legacy semantics.

Evidence: app/supabase/migrations/202610280001_tournament_builder.sql; app/tests/tournament-builder/storage.test.ts

Next: Preserve named history and rerun final integration checks.

**DEL-03 — Normal Overview/Matches/Standings/Admin navigation**

Acceptance: Published builder links converge on Overview; drafts converge on builder; native admin and private-data gates hold; legacy render bodies remain intact.

Evidence: app/docs/evidence/normal-tournament-routes-local-2026-10-28.json

Next: Keep final hosted smoke linked to committed source.

**DEL-04 — Round robin, playoffs, ranking and every placement**

Acceptance: F01 persists 28 RR fixtures +2 semifinals +final with shared third, complete lower placements and stable fixture identities.

Evidence: app/tests/tournament-builder/storage.test.ts; app/lib/tournament-builder/runtime.ts

Next: Close hosted full-size acceptance separately.

**DEL-05 — Direct score entry and audited result correction**

Acceptance: Valid direct results advance once; opponent confirmation/admin validation and correction/replay/withdrawal boundaries retain history.

Evidence: app/tests/tournament-builder/corrections-storage.test.ts; app/docs/evidence/direct-score-browser-local-2026-10-28.json

Next: Retain final exception-matrix evidence.

**DEL-06 — Real-account administrator enrollment**

Acceptance: Existing profile IDs/DUPR links retained; no name-only guest creation, fake account, fabricated personal consent or false invitation.

Evidence: REAL-ACCOUNT-ENROLLMENT.md; app/docs/evidence/registered-account-admin-mcp-local-2026-10-28.json

Next: Verify latest owner UI and external-client result in final source.

**DEL-07 — Explicit scoped administrator OAuth/MCP**

Acceptance: Fresh admin consent drives cookie-free bearer-only HTTP tools through current role/grant/revision checks; result receipt replay remains single-effect.

Evidence: app/docs/evidence/registered-account-admin-mcp-local-2026-10-28.json; app/lib/tournament-builder/mcp-admin.ts

Next: Complete actual external-client acceptance separately.

**DEL-08 — Production runtime and completed user tournament**

Acceptance: Final app.picktennt.com deployment is READY; metadata returns 200 with all three scopes, unauthenticated MCP returns 401, and existing user event remains completed at revision 43.

Evidence: BUILD-STATUS.md; deployment dpl_B2XtEZgZcQwqKhsdVP7FxJ5MW4e4

Next: Anchor the final deployed source to a durable reviewed commit.

**DEL-09 — Owner actions and administrator management**

Acceptance: Native owner adds/removes real administrators through reviewed preview/checkbox. Fresh owner-scope HTTP MCP publishes, replays, delegates/removes and cancels; old admin grants stay restricted and revocation denies owner access.

Evidence: app/docs/evidence/owner-admin-browser-local-2026-10-28.json; BUILD-STATUS.md

Next: Delivered; new owner actions require current ownership, explicit preview confirmation and current hash/revision.

**OWN-01 — Finish owner administrator-management controls**

Acceptance: Only current owner previews/reviews and commits add/remove administrator actions; revision/hash/explicit confirmation and role invariants hold.

Evidence: app/docs/evidence/owner-admin-browser-local-2026-10-28.json; BUILD-STATUS.md

Next: Delivered; keep current role/preview/revision protections in future changes.

**ACC-01 — Fresh Claude owner-scope connection and live user check**

Acceptance: User reconnects with all requested permissions and sees owner preview/commit tools, then can explicitly authorize a concrete current owner action. Do not claim a live owner mutation from earlier tool discovery.

Evidence: Actual prior Claude administrator-tool discovery; BUILD-STATUS.md; local owner HTTP MCP evidence

Next: Async user connection question remains pending. This is an external account handoff, not missing implementation.

**FOL-02 — Actual ChatGPT onboarding and equivalent draft**

Acceptance: If the owner later chooses ChatGPT, its actual account authenticates, discovers modules and saves a supported equivalent draft.

Evidence: PRD.md; ACCEPTANCE-TESTS.md F01

Next: Do not block the accepted ChatGPT OR Claude goal: the owner selected Claude. Only expand client acceptance when requested.

**FOL-03 — Complete full-size hosted doubles acceptance**

Acceptance: If requested, a controlled hosted test repeats the already locally verified eight-team doubles flow using explicitly authorized test identities.

Evidence: ACCEPTANCE-TESTS.md F01; existing local F01 SQL and hosted four-singles evidence

Next: Do not add a new release gate or paid environment absent a concrete failing bounded-MVP path. Existing local SQL/browser evidence remains applicable.

**ACC-04 — Final complete acceptance and native/legacy regression matrix**

Acceptance: Final scoped implementation passes automated, SQL, browser, role, correction and source-preservation checks. Selected Claude discovery and actual user completion are distinguished from local protocol proof; optional expansion is not a release gate.

Evidence: 213 automated tests; 14 local browser cases; BUILD-STATUS.md; final hosted smoke

Next: Retain explicit evidence limits; no further code work identified for this accepted increment.

**REL-01 — Preserve implementation in reviewed source commits**

Acceptance: Only vetted MVP files are committed; original dirty session work and existing legal/source lineages remain preserved; final build runs on committed assembled tree.

Evidence: RELEASE-PLAN.md; RELEASE-ALLOWLIST.json

Next: Commit `51adade` contains the 128 audited application files and matches the approved remote feature branch. Original dirty files and master-owned legal work remain untouched. No merge was performed.

**REL-02 — Exclude credentials and local artifacts**

Acceptance: No env, auth material, .vercel, supabase/.temp, test-results, PEM, dependency or build artifacts enter Git/deploy payload.

Evidence: app/.gitignore; app/.vercelignore; RELEASE-ALLOWLIST.json

Next: Maintain exact-path staging and rerun the sensitive-path check when adding future files.

**REL-03 — Preserve master legal pages and session source during integration**

Acceptance: Master-owned legal guard remains paired with its content; session lineage preserved; no iOS-main mix-up or destructive checkout/reset.

Evidence: RELEASE-PLAN.md; RELEASE-ALLOWLIST.json legal blob comparisons

Next: Use separate clean master-based integration and inspect merge; no isolated config-only staging.

**REL-04 — Create remote draft PR after local source freeze**

Acceptance: Authenticated account can create the correctly based draft PR; explicit nonforce push targets its own branch and PR is attached to task.

Evidence: gh auth status; RELEASE-PLAN.md; DRAFT-PR.md

Next: Saved gh token is invalid; refresh authentication through normal user login when remote publication is authorized.

**REL-05 — Refresh portable release instructions and evidence pointers**

Acceptance: Current instructions list exact applied/pending named migrations, account-only enrollment, direct scoring, no rest enforcement, scoped admin actions, final SHA and honest client limits.

Evidence: app/docs/tournament-builder-release.md; BUILD-STATUS.md; RELEASE-PLAN.md; DRAFT-PR.md

Next: Final application checkpoint is `51adade`; use the release plan for preservation-safe source integration.

**FOL-01 — Resolve pre-existing repository-wide lint errors separately**

Acceptance: Baseline internal-anchor and effect-state lint errors are fixed with appropriate regression evidence, without mixing unrelated changes into the tournament release.

Evidence: app/app/page.tsx; app/components/tournament/admin-upload-dupr.tsx

Next: Keep separate issue/commit after MVP; do not block scoped clean feature lint.

Local browser/SQL tests use isolated synthetic native identities. They do not prove an actual external Claude owner mutation or real remote DUPR verification. Account-free guests and elapsed rest are superseded requirements; historical migration files do not re-enable those features.
