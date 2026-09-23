# Session Games — 1.1 (27)

Branch: `codex/session-games`; app baseline `372f3ba` (1.1 build 26), web baseline `db47450`. The web branch also merges production security/dependency fixes from `4ffdbe6` before deployment.

## Implementation

- iPhone Sessions contain Games, Create Game and Add Final Score. Singles/doubles, per-game partner choices, scoring rules, optional court, scorer invitation and explicit acceptance/decline are supported.
- Accepted assignments are reserved. The Watch Sessions screen syncs accepted games through the paired iPhone and prepares them for offline use. Start Game retains serve and starting-side setup; Quick Game is unchanged.
- Canonical `play_session_games` and `play_session_game_operations` store participant snapshots, revisions and an audit trail. Authenticated RPCs enforce permissions, active roster selection, idempotency and score validity. No tournament tables are used.
- Manual and Watch results await confirmation. Opponents of the submitter or the organizer may confirm; only the organizer resolves disputes. If the submitting organizer is outside the lineup, the organizer confirms. Corrections return to pending confirmation.
- Only confirmed games count in history and analytics. Each participant gets the correct outcome and session attribution. Canonical IDs merge the shared result with the scorer's local Watch details. Health stays private. Personal deletion does not delete the shared result.
- A persisted iPhone outbox owns the health-free result before acknowledging Watch receipt. Transfer payloads, recovery snapshots and Watch cache retain session identity and assignment revision. Account generations gate new commands and late replies.
- Current Watch result and delete envelopes use V3 owner/generation checks; obsolete current-account commands are rejected without blocking later compatible sync. Shared scorer rows are not re-exported as ordinary private backups.
- Legacy transfers stay quarantined. Link Watch explicitly verifies the compatible account-binding protocol before reconnecting a Watch previously quarantined by the baseline version.

## Rollout order

1. Deploy `011_play_sessions.sql` to the existing Supabase project.
2. Deploy the existing `/s/[code]` invitation route and associated-domain file from the web Sessions baseline. Verify the production invitation URL resolves.
3. Apply `012_session_games.sql` from this branch.
4. Install iPhone and Watch 1.1 (27), then execute the live checklist below.

`011_play_sessions.sql` was applied through the authenticated Supabase SQL editor on September 23, 2026. Web invitation deployment and `012_session_games.sql` are in progress. Never use synthetic demo tokens against production. Keep live verification open until real-account tests pass.

## Local verification

`PicktenntCore` tests: `swift test --package-path PicktenntCore`.

Xcode schemes: `Picktennt` (iPhone unit tests), `PicktenntWatchTests` (Watch scoring/recovery/sync), and `PicktenntUITests` (simulator UI). Select an available matching simulator.

The web repository contains `scripts/test-session-games.mjs`, which applies the actual migrations to isolated PostgreSQL/WASM using `@electric-sql/pglite`. Set `PGLITE_MODULE` to the package's installed module if it is outside the repository.

For iPhone UI tests, start `scripts/session-games-simulator-server.mjs` from the web repository with the same `PGLITE_MODULE`. The DEBUG-only opt-in `PICKTENNT_SESSION_GAME_TEST_SERVER=1`, together with `PICKTENNT_APP_STORE_DEMO=1`, routes session and session-game requests to 127.0.0.1:8765. The server is in-memory; restart it to reset fixtures. Invitation UI tests create their own game. Do not restart it between the preparation, offline scoring, and reconnection phases. This is local integration coverage, not live-account verification.

## Verification evidence (September 23, 2026)

- Core: 52 passing checks (9 XCTest + 43 Swift Testing).
- Database: 79 passing checks against the actual 011/012 migrations, including full sessions, occupied seats, removed players, per-game partner changes, revisions, permissions, idempotency, corrections, disputes and score boundaries.
- Paired simulator devices: **Session Games Build 27 QA** (iPhone 17, iOS 26.5) and **Session Games Build 27 Watch QA** (Series 11 46 mm, watchOS 26.5). The original simulator pair and its recovery data are preserved.
- Passed real WatchConnectivity preparation; 11–0 scoring and saving with the iPhone shut down; reconnection/upload; and opposing-player confirmation. Database stayed in progress while disconnected, then moved to pending and confirmed after reconnection.
- Passed the full iPhone four-account local flow: create a session, join, submit a manual final, confirm as an opponent, and see the result in all four histories.
- Passed iPhone game creation, invitation to a different scorer, account switching and explicit acceptance; Watch Quick Game still presents serve and starting-side choices.
- Simulator accounts are synthetic DEBUG identities restricted to the local server. These results do not satisfy four-real-account production verification.

## Required live checks (KAN-192)

- Four separate real accounts join a shared invitation URL. Confirm capacity, removals, navigation and sharing.
- Create singles/doubles games; change registered partners for one game; verify session registration remains unchanged. Reject duplicated/non-member players and nonparticipant creators.
- Assign scorer, decline and reassign, accept on iPhone and Watch. Verify accepted assignment cannot be replaced, delivery is visible, and invitations do not interrupt an active Quick Game.
- Prepare with connectivity; disconnect and score; terminate/recover; reconnect and upload exactly once. Repeat requests and switch accounts; stale account/assignment commands must fail.
- Enter manual finals, reject invalid scores, confirm from the opposing team, dispute and resolve as organizer, correct and reconfirm. Unfinished games never count as wins/losses.
- Check all four histories, correct outcomes, session/game navigation, private Health, duplicate prevention, roster departure attribution and personal-history deletion.
- Retest Quick Game, serving choices, previous scoring modes and existing Watch sync. Keep this checklist open until every check has evidence.

## Jira

KAN-189 backend; KAN-190 iPhone; KAN-188 Watch; KAN-191 history; KAN-192 deployment and live verification.
