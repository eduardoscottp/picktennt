# MVP acceptance tests and evidence

Target specification: PRD.md v3.0 plus the current October 28 amendments: chosen Claude OR client, no elapsed rest, no separate Start game, real profiles and scoped administrator/owner parity. These are required test cases and expected outcomes, not executed application results. Record actual commands, environment and outcomes in BUILD-STATUS.md.

## Test layers

1. Pure contracts/algorithms: strict manifest grammar, score legality, pairings, seeding, rankings, corrections and withdrawal effects. Use deterministic clocks and injected draw outcomes in tests.
2. Database integration: real PostgreSQL/Supabase with ordinary users, valid delegated identities and an isolated test dataset. Exercise actual policies, transactions, constraints and concurrent requests. Mocks cannot prove these properties.
3. Browser: existing auth/callback/confirmation, invitations, roster, score confirmation, administration and new review screens in staging.
4. Real connector: authenticate and create a draft from the user’s chosen Claude account; ChatGPT is an optional follow-up. Record account capability, safe tool names and saved draft evidence without tokens or raw private chat logs.
5. Deployment: after authorization, smoke-test the actual released URL. A successful local build or staged schema is not publication evidence.

## F01 — eight-team complete tournament

Use examples/tournament-definition.json; test dates may be advanced using a fake clock, never silently mutate the saved fixture. Teams A–H each contain two distinct consented test players. Owner is separate and not playing. Four courts, one full RR, top-four playoffs, bronze disabled, 11 win by two.

1. Connect AI, discover modules, create incomplete draft, answer missing fields and save complete definition.
2. Owner reviews the exact revision and publishes on the website or after a current owner-scoped preview and explicit confirmation. No player entry is created for the owner.
3. Revoke the AI grant. Subsequent assistant writes fail; the website continues.
4. Register and approve eight complete teams. Close registration, lock roster and commit schedule.
5. Expect 28 unique RR fixtures, seven per team, seven court waves. No court number exceeds four and no player appears twice in a wave.
6. Start the event, then enter scores directly without Start game or a rest wait. For every pair, alphabetically earlier team wins 11–5. Submit as one side and confirm as the other, or use authorized administrator validation.
7. Expect wins A=7,B=6,C=5,D=4,E=3,F=2,G=1,H=0. No exact tie. Qualifiers A,B,C,D appear once.
8. Expect semifinals A–D and B–C. A and B win 11–7. Final A–B: A wins 11–9.
9. Expect 31 total fixtures, champion A, runner-up B, C/D shared third, E/F/G/H in RR order. Event completes automatically and records a result version. No LLM call occurs after publication.
10. Replay final confirmation with the original operation ID; no second advancement, result version or event completion is created.

Verify creation with the actual chosen Claude client. A fabricated MCP client is not a substitute for this account evidence. Separate local HTTP MCP integration can establish command/security behavior; label each evidence layer.

## F02 — scores and submitting-side confirmation

| Target / margin | Score | Expected |
|---|---|---|
| 11 / 2 | 11–9, 11–0, 12–10, 15–13 | Valid played outcome |
| 11 / 2 | 11–10, 12–8, 10–8, 11–11 | Rejected |
| 11 / 1 | 11–10 | Valid |
| 11 / 1 | 12–11 | Rejected: game should have ended at 11 |
| 15 / 2 | 15–13, 16–14 | Valid |
| 21 / 2 | 22–20 | Valid |
| Any | Negative, fractional, missing or nonnumeric scores | Rejected |

- B submits; A may confirm, B and B's partner may not. Repeat with A submitting.
- A player from another match/event cannot read private mutation details or submit/confirm this match.
- Ordinary administrator played-score validation may use the website’s recorded default audit reason. Disputes and exceptional outcomes require an explicit reason. Administrator players use the audited validation action.
- Two score submissions at the same revision: one accepted provisional write; the other conflicts.
- Disputed scores do not contribute to qualification; accepted adjudication updates all affected projections once.

## F03 — graph and definition validation

- Accept the three exact module patterns in MODULES.md.
- Reject cycle, dangling edge, disconnected node, duplicate node ID, unknown module/version, undeclared configuration key and unsupported composition.
- Six qualifiers returns INVALID_ADVANCEMENT with allowed values 2/4; preserve draft.
- Reject min_entries > max_entries, invalid timezone/offset, deadline after start, unsupported scoring and invalid court count.
- Keep incomplete drafts with precise missing_fields; publication must fail until resolved.
- A stale review revision cannot publish newer unseen settings. Warning acknowledgements are revision-bound.
- A normal organizer choosing a title already used by another owner can create a different ID; join codes remain unique.
- Assistant-provided owner/actor/status/winner/hash fields fail strict validation.
- An attempted edit after publication fails PUBLISHED_DEFINITION, including attempted edits through old routes.

## F04 — registration, privacy and concurrency

- Invitation GET produces zero database mutations for anonymous and signed-in users.
- Two partners explicitly consent to the published definition. Inviting a person does not grant their consent.
- Partner fails acceptance: no half-approved team, no slot consumed and no false tournament_players approval.
- Same user attempts a second active entry: fail DUPLICATE_ENTRY in API and direct guarded database path.
- Two complete teams concurrently request the last slot: exactly one approved, the other remains pending with CAPACITY_FULL.
- Closing/deadline crossing while a request is in flight is checked in the commit transaction.
- Missing/incomplete entries cannot lock into a roster. Locking at six entries is legal for RR but rejected for direct elimination.
- Owner selects organizer_plays=false: only admin membership exists. Selecting true still requires normal registration and doubles consent.
- Private profile email and unrelated memberships are absent from public pages and MCP outputs.

## F05 — scheduling and bracket structure

- RR counts: n=2→1, n=3→3, n=5→10, n=8→28, n=16→120. Each pair once, each entry n−1 matches.
- Test courts=1,2,4,8, including odd rosters; every wave respects courts and player uniqueness.
- Direct bracket n=2/4/8/16 has n−1 competitive fixtures without bronze; bronze adds one only when n≥4.
- Eight-entry leaf order is 1,8,4,5,2,7,3,6; seeds 1/2 can meet only in the final. Test the corresponding recursive 16-entry order.
- Bronze=false creates no bronze fixture. On one court, final and bronze are successive waves; no fixture has court 2.
- Two concurrent startMatch calls sharing a court or player: one fails and no double occupancy is persisted.
- Recent completion and saved minimum_rest_minutes never block starting or scoring. No separate Start game action or synthetic started_at is required for direct result entry. Unresolved/ineligible feeders and illegal scores still fail.
- Fixture generation retry and process restart create no duplicate schedule. Roster revision change invalidates an old schedule preview/commit.

## F06 — standings and draws

- Approved roster entries appear with zero statistics before their first accepted result.
- Provisional, disputed and void outcomes contribute zero official statistics.
- Played results contribute wins/losses and points; retirement/walkover contributes win/loss only; no-contest neither.
- Verify each supported ordered tie metric against a worked fixture; legacy ordering remains unchanged for legacy events.
- Three singles A,B,C: A beats B 11–9, B beats C 11–9, C beats A 11–9. Each has 1 win, 20 points for/against and zero differential. Standings remain tied.
- With top-two qualification, exact tie blocks selection. Admin requests draw at the current revision; the test injects order C,A,B. Store it once; qualifiers C/A. Retry returns identical draw. A changed result revision invalidates the old draw's applicability.

## F07 — correction dependencies

- Prepare F01 through RR. Correction changes the fourth qualifier before playoffs start: impact preview lists changed ranks and only affected unstarted playoff fixtures. Commit changes those assignments and keeps unrelated played history.
- Start a dependent semifinal; ordinary correction returns DOWNSTREAM_STARTED and makes no changes.
- Explicit void-and-replay at the current preview revision preserves the semifinal result/history, marks affected downstream results void, and produces corrected replay assignments. Unaffected branch stays intact.
- Another result arrives after preview: STALE_PREVIEW; no partial changes.
- Reopen completed tournament as owner: mark placements under review. Reclose after corrected outcomes with a new result version and retained prior placements in history.
- Admin without ownership cannot reopen completed results or cancel the event.

## F08 — withdrawal and exceptional outcomes

- Before roster lock: cancellation frees slot without deleting profile/team history.
- After lock before any match starts: withdraw entry, archive old generation, return to roster review. Direct bracket relock rejects unsupported remaining size.
- During incomplete RR: H withdraws after several played matches. Every H result is excluded from that stage's ranking; future H fixtures are no-contest; other played matches retain their facts. Remaining seven teams rank from their mutual results.
- After RR complete but before playoffs start: D withdraws; E replaces D at the supported ranked position. Preserve accepted RR results.
- After any playoff starts: D withdraws; no new qualifier is inserted; its assigned opponent advances by recorded walkover.
- A retirement without event withdrawal records opponent win/loss and informational partial score with no point contribution.
- Withdrawal during an active match releases its court and atomically records retirement/no-contest as appropriate; incomplete-RR ranking exclusions still apply. Cancellation releases all active claims without fabricating played wins.
- Both sides withdrawn: no-contest/empty slot propagates once. No eligible champion: blocked; owner cancels with no winner.
- Withdrawal retries, stale previews and concurrent correction are guarded by operation and event revision.

## F09 — authorization, idempotency and atomicity

- Owner A cannot access B's private drafts or mutate B's event via IDs, references or tools.
- Wrong issuer/audience, expired token, revoked grant or wrong client binding fails before access and before receipt replay.
- Authenticated direct REST inserts/updates/deletes cannot bypass modular guards on tournament/roster/results, even if a permissive legacy policy also exists.
- Existing elevated server routes cannot bypass modular command dispatch; inspect all call sites.
- Same operation ID + same request returns its original safe result; different request hash fails IDEMPOTENCY_CONFLICT.
- Inject failure after score write but before dependent advancement inside the database command: transaction rolls back score, stages, assignments and receipt together.
- Disconnect after commit before response: getOperation returns committed result; retry creates nothing new.
- Reject cross-tournament round/team/fixture references at database boundary as well as API.
- Preserve last owner when existing admin removal paths run. Prevent forged actor/user IDs in requests.

## F10 — regressions and full client/UI evidence

- Existing Google login, auth callback, email confirmation and user profile flows still pass.
- Legacy tournament registration, team selection, score confirmation, brackets, standings, removal and applicable DUPR paths retain their expected behavior.
- Existing invitation URLs still resolve; modular invitations are read-only until Join.
- Existing Android/Wear session contracts and the repository's session integration suites pass without schema/semantic changes.
- At 360px width, review rules, Join, partner consent, score submission/confirmation and correction are usable without clipped primary actions. Keyboard focus, labels and text errors work.
- Disconnect/reconnect browser: state refetch shows authoritative current event; no duplicate action caused by refresh.
- The actual chosen Claude account saves a draft and reaches authenticated review/owner preview. A published tournament completes after revoking that grant with zero runtime AI calls. Record fresh administrator/owner tool discovery separately from actual mutations.

## F11 — deployment and recovery

- Record migration diff and pre/post row/ownership/fixture/result counts on sanitized staging data.
- Old rows route to legacy; only opted-in new events route modular_v1.
- Disable new modular creation: existing authorized modular events remain accessible through compatible code, or affected writes are explicitly stopped while preserving data.
- No rollback drops history or reinterprets modular outcomes using legacy score comparisons.
- After authorized production migration/deployment, record actual URL/commit and smoke-test login, read-only invitations, draft publication and a bounded test event using explicit test identities.

## Requirement coverage

| Requirements | Fixtures |
|---|---|
| R01 | F10,F11 |
| R02,R03 | F03,F01 |
| R04 | F04,F09 |
| R05 | F05 |
| R06 | F02,F09 |
| R07 | F06 |
| R08 | F01,F05,F09 |
| R09 | F07,F08 |
| R10 | F04,F09 |
| R11,R12 | F01,F10 |
| R13 | F10 |
| R14 | F09,F10,F11 |

Do not replace failing requirements with weaker assertions. Mark external account/access constraints honestly and continue independent work; the chosen-client MVP remains incomplete until its required real-client evidence and current owner-parity acceptance are demonstrated.

## F12 — registered identities and full owner parity

- New enrollment requires existing real profile IDs, exact singles/doubles cardinality, deadline, capacity and current membership checks; no guest/account/DUPR fabrication. Administrator admission never impersonates personal consent. Canceling such an entry rejects all player projections.
- Routine assistant administration needs newly consented tournaments:admin; owner actions need tournaments:owner and actual current ownership. Old grants never expand implicitly.
- Publication, cancellation, completed-result reopening and administrator add/remove require a current concrete preview and explicit confirmation. Stale/revoked/wrong-role calls and cached-receipt recovery are denied. Delegated administrators cannot acquire owner rights.
- Administrator changes select real profiles, protect the owner, preserve succession and before/after audit, and immediately remove revoked administrators’ connector authority. Ordinary snapshots do not expose administrator lists or private contacts.
- Verify native and isolated HTTP MCP owner controls, then smoke-test the actual promoted release. SQL 009/010 local tests alone are not deployment evidence.
