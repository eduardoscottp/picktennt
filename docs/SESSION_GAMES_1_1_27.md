# Session Games — 1.1 (27)

Implemented on `codex/session-games`. iPhone/Watch baseline: `372f3ba`, version 1.1 (26). Web baseline: `db47450`, with production security/dependency fixes from `4ffdbe6` merged before deployment. Both apps remain version **1.1**, build **27**. The original simulator pair and its recovery data are preserved.

## Delivered behavior

- Sessions contain Games, Create Game and Add Final Score. Singles/doubles, per-game partner choices, side-out/rally rules, optional court, and roster validation are supported.
- One participating scorer explicitly accepts or declines. Accepted assignments are reserved. Watch Sessions supports roster-based game creation and connected preparation; starting remains explicit with the existing serve/side choices. Prepared games score offline and recover after relaunch. Invitations do not interrupt Quick Game.
- Canonical session-game records and an operation audit enforce authentication, permissions, revisions, idempotency, valid finals, disputes and corrections. No tournament-specific tables are used.
- Manual and Watch results await confirmation by an opponent of the submitter or the organizer. Only the organizer resolves disputes; corrections require confirmation again. Unfinished games do not count as wins/losses.
- Confirmed games appear in every participant's history with session attribution and the correct outcome. Canonical game IDs prevent duplicates. Personal hiding/deletion preserves the shared result; roster departures preserve historical attribution. Health remains private.
- A durable, health-free iPhone outbox owns Watch results before acknowledgement. Compatible transfer/recovery fields preserve session identity and assignment revision. Account-generation checks reject stale commands without blocking a valid current connection.
- Ordinary Quick Game backup retries now target the unique account/game key. A live duplicate upload previously returned HTTP 409 and left the queue pending; the corrected retry updates one row and passes a dedicated regression test.
- Rejected refresh tokens now finish launch restoration and show sign-in instead of leaving an endless spinner. The expired/revoked-session regression is covered alongside valid-session restoration.
- Fixed credential-field focus loss on Login, invitation-page Button composition, and app-link routing from any iPhone tab. Watch empty rosters show guidance and Refresh. Errors are visible, primary save/create controls are blue, and navigation labels reflect their destination.

## Deployment

Both `011_play_sessions.sql` and `012_session_games.sql` were applied through the authenticated Supabase SQL editor on September 23, 2026, before live testing. The public roster RPC exposes only public player identity fields. Invitation pages and the associated-domain file are deployed.

Production web application commit: `3185c4c`; Vercel deployment: `dDA8z5wJMqTxtHp6TuwmgxjHPAEy`. Share URLs remain HTTPS. Their explicit Open in Picktennt action uses `picktennt://session/<code>`. The public QA invitation `https://app.picktennt.com/s/7048EA88` was verified in the browser and with another signed-in simulator account.

## Verification — September 23, 2026

Devices: **Session Games Build 27 QA**, iPhone 17 / iOS 26.5, paired with **Session Games Watch QA**, Apple Watch Series 11 (46 mm) / watchOS 26.5.

| Layer | Result |
| --- | --- |
| Core scoring and transfer models | 52 passing tests: 9 XCTest + 43 Swift Testing |
| Actual SQL migrations in isolated PostgreSQL/WASM | 79 passing lifecycle, permission and boundary assertions |
| Production backend, four real QA accounts | 47 passing lifecycle assertions + 8 concurrency/idempotency assertions |
| iPhone unit tests | 53 passing tests in the final regression run |
| Watch unit tests | 71 passing tests in 16 suites in the final regression run |
| Web production build | Next.js webpack build passed |
| iPhone and Watch release build | Release build passed for both apps |

All live UI workflows below passed using normal password sign-in/sign-out and four provisioned QA accounts:

| Workflow | Evidence bundle / check |
| --- | --- |
| Create session; four accounts join; manual 11–7; opponent confirmation; all histories; invite another scorer and accept | `Test-PicktenntUITests-2026.09.23_09-51-37--0400.xcresult` |
| Watch creates singles from roster, accepts/prepares, scores 3 points, terminates/recovers, finishes 11–0 and uploads | `Test-PicktenntWatchUITests-2026.09.23_10-07-55--0400.xcresult` |
| Opponent confirms recovered singles; switch to invited doubles scorer | `Test-PicktenntUITests-2026.09.23_10-09-22--0400.xcresult` |
| Invited doubles prepares on the assigned player's Watch | `Test-PicktenntWatchUITests-2026.09.23_10-11-42--0400.xcresult` |
| Watch finishes and saves 11–0 with paired iPhone shut down | `Test-PicktenntWatchUITests-2026.09.23_10-12-40--0400.xcresult`; backend retained no final score until reconnection |
| Reconnection/upload, opponent confirmation, all four histories, visible missing-player and invalid 11–10 errors | Passing method `testLiveConfirmOfflineDoublesAndValidateErrors` in `Test-PicktenntUITests-2026.09.23_10-17-15--0400.xcresult` |
| Teammate cannot confirm; participant disputes; organizer resolves; correction/reconfirmation; private history deletion; history → game → session | Passing method `testLiveDisputeCorrectionAndSharedHistoryDeletion` in the same bundle |
| Shared URL opens from History; another account leaves/rejoins; Share Invite → Copy; back to session list | `Test-PicktenntUITests-2026.09.23_10-28-08--0400.xcresult` |
| Quick Game retains serve/side choices; incoming invitation does not interrupt active scoring | `Test-PicktenntWatchUITests-2026.09.23_10-29-41--0400.xcresult` |
| Ordinary Quick Game backup retry clears, sync shows Updated, valid saved account survives cold relaunch | `Test-PicktenntUITests-2026.09.23_10-45-15--0400.xcresult`; the real QA backup queue was independently verified empty |

The combined 10:17 bundle also contains an initial share-test failure caused by assuming the system share sheet had a Close button. The corrected test uses Copy and passed separately at 10:28. Earlier failed runs exposed and led to the login-focus and invitation fixes; other failures were simulator signing, screen-lock, storage or automation-navigation issues. Live offline upload was independently observed transitioning from prepared to pending after reconnection.

Backend and model coverage additionally includes partner changes without modifying registration, singles/doubles, full capacity and competing joins, duplicate requests/uploads, removed players, stale revisions/accounts, unauthorized writes, score boundaries and overtime, unfinished results, retained audit/history, and private Health data. The simulator does not validate physical Health sensors or real-device radio behavior.

## Reproducing verification

- Core: `swift test --package-path PicktenntCore`.
- Xcode schemes: `Picktennt` (iPhone units), `PicktenntWatchTests`, `PicktenntUITests`, and `PicktenntWatchUITests`. Keep default local signing and use `ONLY_ACTIVE_ARCH=YES`; disabling signing breaks simulator Keychain persistence.
- Web scripts: `scripts/test-session-games.mjs` applies the actual migrations to isolated PGlite; set `PGLITE_MODULE` if installed outside the repository. The optional `scripts/session-games-simulator-server.mjs` serves synthetic DEBUG fixtures at 127.0.0.1:8765. These fixtures never authenticate against production.
- Live backend scripts: `scripts/test-session-games-live.py` and `scripts/test-session-games-live-races.py`, each given the private QA credential JSON path.
- Live UI methods require `/tmp/picktennt-session-games-live-qa.json`, mode 0600, containing four account entries with `id`, `name`, `email`, `password`, `url`, `apikey`, `access_token`. The first entry also retains the UI-created `sessionId`, `sessionTitle`, `joinCode`, `invitedGameId`. Use only dedicated QA accounts; never commit this file.
- Run creation first, then Watch singles/recovery, singles confirmation/scorer switch, doubles preparation, offline scoring with iPhone shut down, reconnection and confirmation, then correction/history and shared-link tests. Refresh test-side JWTs before expiry. UI transcripts/result bundles can contain typed test credentials: keep them private and outside Git.

## Jira

KAN-189 backend; KAN-190 iPhone; KAN-188 Watch; KAN-191 history; KAN-192 deployment/live verification. All implementation and live verification checks passed; see these issues for component evidence and status.
