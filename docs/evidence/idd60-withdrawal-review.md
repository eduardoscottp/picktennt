# IDD-60 full-team withdrawal

The latest user instruction supersedes the earlier conditional retirement procedure: the website offers one administrator action, **Retirar equipo**, with explicit confirmation that every current game involving the selected team—past or future—becomes a **0–11 loss**, with **11–0 awarded to its opponent**. The team becomes withdrawn/ineligible and appears last. Per-match Walkover/Retirement options and automated post-start MCP withdrawal are no longer offered. Prestart roster removal/replacement remains separate.

This document describes generic implementation and synthetic tests. It does not identify a production team or prescribe a production data repair. A player's username and a team's numbered label can refer to different entries; the administrator must confirm the actual players in the selected team before any data correction.

## Implemented contract

- Preview kind: `withdrawal`; data: `{entry_id, reason, policy: 'all_matches_0_11'}`.
- Commit command: `withdrawEntry`; same data plus `preview_hash` and `confirmed_forfeit: true`.
- Website administrators may withdraw active teams. Only the owner may change a completed tournament; one confirmed command recalculates its results and increments its result version atomically.
- Every affected current game gets `administrative_score`, validated status, fixed 0/11 points, the opponent as winner, and `submit_to_dupr=false`. The fixed award is independent of the configured played-game target.
- The preview lists prior and proposed outcomes and projected standings. Current revision and preview hash prevent stale changes; operation IDs preserve retry behavior.
- The existing command audit (`before_facts` / `after_facts`) preserves previous results and historical participant identity. Archived matches and unrelated played games are not rewritten.
- SQL migration `202611090004_modular_team_forfeit.sql` independently checks authorization, confirmation, complete affected-match coverage, exact scores, opponent, revision, membership changes and exclusion from DUPR. A forged or partial operation rolls back.
- A game against an already withdrawn/ineligible opponent is rejected atomically: both teams cannot lose the same game 0–11. Missing opponents and unsafe changes to recorded bracket dependencies require manual review. No unrelated played history is silently erased or assigned to different participants.
- Prior external DUPR submissions are not altered automatically. The preview flags potentially affected played history; generated administrative results are not uploaded.

The old stage-sensitive planner remains only for historical/internal compatibility tests. Public web/MCP boundaries and UI enforce the new exposed workflow.

No production data has been changed. Any production data repair requires identification of the exact team by its players, a fresh preview and authorization for that concrete change. Read-only production authorization does not permit applying a repair.

## Validation

`node --import tsx --test tests/tournament-builder/withdrawal-case-regression.test.ts tests/tournament-builder/team-forfeit-storage.test.ts`

10 tests passed: both modular schemas, configured 21-point games with fixed 0–11 awards, past/future/provisional/live results, unchanged unrelated and archived history, required confirmation, stale preview, owner-only completed results, MCP/nonadmin/prestart rejection, withdrawn-opponent rejection, unsafe played dependencies, and real SQL audit/retry/concurrency/forged-effect safeguards.

All fixtures are synthetic. Earlier regression coverage also retains the historical planner's safeguard against silently replacing unvalidated scores without this new explicit full-forfeit confirmation. Final integrated verification and deployment are coordinated separately.

Integrated verification: 449 tournament tests, 22 legacy tests, 15 authentication tests, and two local Chrome/Next/SQL flows passed. The browser flows cover active/completed events, unchanged cancellation, required confirmation, exact past/future 0–11 results, and preservation of unrelated matches. The production webpack build passed with TypeScript checking. ESLint reported no errors (existing broad-type warnings remain).

Release requires migrations `202611090001` through `202611090004` before the application version. This verification uses synthetic local data; hosted legacy registration and real concurrent PostgreSQL sessions still need release acceptance checks. Incompatible seeded brackets reject the operation without partial changes and require manual review.
