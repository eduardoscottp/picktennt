# Picktennt Tournament Builder — MVP PRD

Version 3.0 · 28 October 2026 · Product owner: Eduardo

Status: current acceptance contract, amended 28 October. Local implementation, production release and actual-client evidence are recorded separately in BUILD-STATUS.md. Later amendments below supersede older MODULES.md rest/Start/draft-only wording.

## 1. Product outcome

An organizer describes a pickleball tournament in their own compatible ChatGPT or Claude account. The assistant discovers Picktennt's supported modules, asks for missing decisions and assembles a tournament draft. Picktennt validates the draft and presents it for review. The owner reviews and publishes it on the website or through an explicitly authorized owner-scoped assistant action. Picktennt then handles registration, matches, accepted scores, standings, qualification and final results without calling an AI model.

Players use their existing Picktennt accounts and do not need an AI account. The organizer remains responsible for event administration and can resolve disputes, correct scores and withdraw injured entries through the website.

The success test is a complete tournament created through the organizer’s chosen compatible ChatGPT OR Claude client, including administrative exceptions, grant revocation and duplicate-safe retries. The user chose Claude; ChatGPT onboarding is a follow-up, not a second-client release gate.

## 2. Boundaries and reuse

Reuse the existing Next.js website, Supabase Auth/Postgres, profiles, tournament IDs, invitation URLs, administrative membership, registration tables, teams, rounds, matches, score-confirmation UI and tested tournament algorithms. Keep one application and one tournament rules implementation shared by website commands and the MCP adapter.

Extend `teams` to represent the tournament entry already used by the code: one player for singles, two for fixed doubles. Continue using `matches` for the single game's canonical score. Add versioned definitions, stage state and operation history; do not introduce duplicate entry/game systems for this scope.

Source findings are recorded in MVP-reuse-plan.md. An inventory of deployed schema, triggers and policies precedes implementation of migrations. Existing mobile session functions and historical tournament behavior require regression coverage.

## 3. MVP scope and limits

| Area | Included behavior |
|---|---|
| Sport | Pickleball, final-score entry |
| Entries | Singles or fixed doubles; 2–16 entries, up to 32 people |
| Venue | One venue, explicit IANA timezone, 1–8 courts |
| Match | One game; target 11/15/21; win by one/two; no score cap |
| Scoring mode | Side-out or rally, recorded in published rules; no rally-by-rally officiating |
| Formats | Full one-group round robin; direct single elimination; round robin then top-two final or top-four playoff |
| Direct bracket | Actual initial roster size 2, 4, 8 or 16 |
| Ranking | Wins primary; selectable supported secondary metrics; recorded draw for remaining exact ties |
| Registration | Public or unlisted event; open acceptance or admin approval; explicit consent; complete fixed teams |
| Administration | Admission, roster lock, start, score attestation/disputes, corrections, withdrawals, cancellation |
| Creation | Complete web draft flow plus MCP drafting from the chosen ChatGPT OR Claude client |
| Publication | Exact-revision owner review on the website, or owner-scoped assistant review/confirmation |

These are supported acceptance limits, not measured server capacity. Existing formats outside this set remain legacy functionality; the new assistant must not advertise them as supported modular compositions.

Deferred: league seasons, payments, automatic waitlists, rotating partners in the new builder, multi-game matches, custom executable modules, arbitrary rule formulas, a drag-and-drop editor, a new scorekeeper role, ownership-transfer workflow, email/SMS delivery and native/watch tournament scoring.

Registration opens immediately on publication. The deadline is checked on every admission; an organizer explicitly closes and locks registration. There are no scheduled opening jobs or background notifications in this MVP. Court plans are estimates, not guaranteed finishing times.

## 4. People and authority

| Actor | Permissions |
|---|---|
| Visitor | Safe public/unlisted invitation information; no private account data |
| Player | Own registration and consent; start own eligible match; submit own score; confirm opponent submission; dispute a score |
| Administrator | Admission, roster/schedule management, event start, disputes, audited score override, corrections and withdrawals |
| Owner | Administrator powers plus publication, cancellation, reopening completed results and existing admin management |
| Connected assistant | Explicit draft, routine administrator and owner scopes; every action follows current account role and event authority |

The creator is owner through the existing ownership/admin model. Organizing does not automatically enroll that person. `organizer_plays` is an intention; the owner still completes normal registration/partner consent. Guard owner removal through every existing admin mutation path for modular events. A platform-support role does not arise from a client-editable profile value.

Roles and connector grants are checked at the time of each command, including an idempotent retry. Revocation takes effect even when a browser or AI conversation remains open. Public read models omit emails, unrelated memberships and medical details.

## 5. Permanent concepts

- **Player:** authenticated Picktennt profile, reused across events.
- **Entry:** one singles player or a fixed doubles team, stored through teams/team_members.
- **Registration:** entry request with participant consent and admission status; it is distinct from a profile account.
- **Match:** one contest between entries, containing one game for this release.
- **Stage:** a logical competition phase, distinct from the current `rounds` court waves.
- **Module:** versioned trusted code plus a descriptor of inputs, outputs and allowed settings.
- **Definition:** saved graph and policies, immutable when published.
- **Accepted outcome:** a confirmed played result or audited administrative result. A submitted score is provisional.
- **Operation:** a permitted command with an operation ID, actor, expected revision and persisted receipt/history.

## 6. Module compositions

The catalog contains `registration@1`, `entries@1`, `round_robin@1`, `standings@1`, `qualify@1`, `elimination@1` and `placements@1`. Scoring and administrative policies are shared services used by stages.

Allowed paths:

1. Registration → Entries → Round robin → Standings → Placements.
2. Registration → Entries → Elimination → Placements.
3. Registration → Entries → Round robin → Standings → Qualification → Elimination → Placements.

Every node has one upstream node except registration. Reject extra nodes, disconnected nodes, cycles, unknown versions and other graph patterns. Do not execute expressions or code supplied by an assistant. The assistant distinguishes missing information, unsupported capability and conflicting requirements.

Each module's implementer assignment, data types, triggers, correction behavior and tests are specified in MODULES.md.

## 7. Organizer experience

1. Connect Picktennt through the AI client's normal authorization flow.
2. Describe an event, such as eight fixed doubles teams with round robin and top-four playoffs.
3. The assistant reads capabilities and asks only missing questions: date/time/timezone, venue/courts, capacity, registration deadline, scoring, ranking and competition structure.
4. The backend stores an incomplete draft and returns field-specific errors or missing decisions. Defaults are shown, not silently invented.
5. Preview displays the graph, rules, expected matches, estimated court waves, admission conditions and exception policies.
6. Owner reviews the exact revision and warnings on the website, or reviews the concrete owner-action preview and explicitly confirms through a newly owner-scoped connection.
7. Registration and operation continue through Picktennt. The assistant cannot edit a published definition.

The web form uses the same definition contract and validation results. A disconnected or ineligible AI account does not prevent manual web creation. Actual chosen-client evidence must be distinguished from synthetic MCP tests.

## 8. Registration and roster

Every new entry references real existing Picktennt profiles. Opening a link is read-only. A player signs in, selects Join and accepts the published rules. Singles creates an entry with one consented player. Doubles requires consent from both identified partners. The organizer can invite but cannot impersonate acceptance. An authorized administrator may instead enroll existing profiles with admission_source administrator and a current definition binding; personal-consent fields remain null unless those people actually consent. Preserve original profile/DUPR links. Registration does not create or verify a DUPR identity, and this increment does not implement modular DUPR export.

Entry registration states: `awaiting_partner`, `pending_approval`, `approved`, `rejected`, `withdrawn`, `cancelled`. Pending/incomplete entries do not reserve a slot. Open mode attempts admission after all consent is present; approval mode requires an admin action. A losing last-slot request remains pending and reports CAPACITY_FULL.

Serialize admission against the tournament capacity record. A player cannot be in two active entries in one event. Capacity is measured in complete approved entries; maintain current `max_players` as a compatibility value equal to entry capacity multiplied by roster size.

After explicit close, the organizer reviews and locks the eligible roster. Verify actual counts, roster completeness, consent revision and bracket feasibility again. Locking records a roster version and fixes the seeded order. The owner can reopen registration before locking; after locking, return to roster review explicitly before making pre-start roster changes. No silent substitutions after play begins.

## 9. Scoring, confirmation and ranking

For a target T and win by one, a completed played score has winner=T and loser<T. For win by two, winner=T with margin≥2, or winner>T with margin exactly 2. Scores are nonnegative integers and distinct. Examples at T=11, win by two: 11–9, 12–10 and 15–13 valid; 11–10 and 12–8 invalid.

Resolved eligible fixtures in an active event accept direct final-score submission or administrator Save & Validate without a separate Start game action. Do not invent a physical started_at timestamp. Legacy explicit start commands remain compatible and enforce court/player occupancy and eligible dependencies. Elapsed rest never blocks starting or scoring; saved minimum_rest_minutes is historical compatibility data.

The submitting entry is recorded. Only the actual other entry may confirm; submitter and teammate may not. An admin may attest with an explicit reason; a participating admin's override is visibly recorded. Only accepted outcomes affect rankings or advancement. A dispute blocks acceptance until adjudication.

Supported ranking keys: `wins_desc` first, then a unique ordered subset of `differential_desc`, `points_for_desc`, `points_against_asc`, `points_for_in_losses_desc`. Default: wins, differential, points for. The existing fixed ranking remains the legacy policy for legacy events.

Include every eligible roster entry, including zero-match entries. Only accepted played scores contribute point totals. Accepted retirement/walkover outcomes count win/loss without invented points; no-contest counts neither. Stage-nullified outcomes contribute neither. Exact ties remain tied until an admin explicitly requests a recorded draw for that tied group and current input revision. Persist the draw once and disclose it; no database-order tiebreaker.

## 10. Progression, courts and results

Canonical modular tournament states: `draft`, `registration_open`, `registration_closed`, `ready`, `active`, `completed`, `cancelled`. Close → lock roster and commit schedule → ready → explicit start → active. Completion is automatic after terminal outcomes and placement ties are resolved.

Stage states: `waiting`, `ready`, `completed`, `blocked`. Waiting is an ordinary unmet dependency; blocked requires a decision. A failed command rolls back and can be retried. Short server commands persist both the accepted fact and its dependent transitions atomically. There is no process that needs to remain alive for days.

Round robin schedules every unordered pair once. Court waves contain at most the configured court count and no repeated entry. Elimination uses conventional seeding, keeping seeds 1 and 2 in opposite halves. Eight-entry opening order: 1–8, 4–5, 2–7, 3–6. Qualifier inputs are ranked; direct elimination uses a once-recorded draw. Roster lock fixes the order.

Top-four semifinals are 1–4 and 2–3. Winners feed the final. A bronze match is configurable. Without bronze, semifinal losers share third; earlier elimination losers share their exit-round rank group. RR-only champion is highest eligible rank after all required outcomes and ties resolve. Nonqualifiers in combined events retain RR ordering below playoff places.

Estimated slot duration is planning information, not an elapsed-rest gate. Existing explicit start commands enforce court/player occupancy. Direct result entry requires resolved eligible sides and legal scores. Previews cannot promise a fixed end time; no external calendar optimization service is included.

## 11. Corrections and withdrawals

Every correction requires a server impact preview, current revision, reason and explicit admin commit. Keep before/after outcomes and affected fixture history.

- If affected downstream matches have not started, regenerate only those affected assignments and projections; preserve unaffected matches.
- If any affected downstream match has started/resolved, block an ordinary correction. An explicit void-and-replay operation preserves those results in history, voids the affected dependency chain and schedules the corrected fixtures for replay. Never silently replace players in a started match.
- The owner can reopen a completed event for correction; placements become under review until a new result version completes.

Withdrawal applies to the entire entry and records a generic reason, actor and effective stage:

| Timing | Consequence |
|---|---|
| Before lock | Cancel entry and release its slot |
| After lock, before any match starts | Archive that schedule generation, return to roster review and explicitly relock |
| During incomplete RR | Exclude all outcomes involving the withdrawn entry from that stage's standings; future matches become no-contest; retain facts |
| After completed RR, before any playoff starts | Preserve RR facts; replace qualifier from next eligible rank, or retain empty slot/walkover if no replacement |
| After playoffs begin | No backfill; opponents advance by walkover |
| Both bracket sides ineligible | No-contest, propagate empty slot; no fabricated champion |

A retirement without event withdrawal awards the opponent a win with partial points informational only. A no-show can be an audited walkover. Disqualification uses the same stage policy with a distinct reason. If no eligible champion can emerge, block completion; owner cancellation closes without a winner. Cancellation preserves history and stops operational writes.

If an entry withdraws during an in-progress match, the same command records a retirement, releases its court claim and records the physical end time. An eligible opponent is the winner; both ineligible sides produce no-contest. The incomplete-RR exclusion rule still takes precedence for ranking. Cancellation closes active court claims without creating played winners.

These policies are explicit MVP implementation defaults derived from the previous PRD's proposals. Show them at publication; future alternative policies require a versioned contract and tests.

## 12. Numbered acceptance requirements

| ID | Required outcome | Primary tasks |
|---|---|---|
| R01 | Reuse identities/core tables; preserve legacy events and native session contracts | T00,T03,T10 |
| R02 | Seven versioned modules, exact supported graph grammar and field errors | T01,T02,T05 |
| R03 | Authorized incomplete drafts, conflict detection, preview and exact-revision publication | T03,T04,T07 |
| R04 | Explicit player/partner consent, unique membership and atomic capacity | T03,T04 |
| R05 | Roster lock, legal fixture counts, conventional seeds and court constraints | T04,T05 |
| R06 | Valid scores, correct opposing confirmation, audited override and disputes | T04,T06 |
| R07 | Versioned ranking, zero-result entrants and persisted exact-tie resolution | T05,T06 |
| R08 | Automatic qualification/placements, retries and restart independence | T04,T05 |
| R09 | Impact-reviewed corrections and full withdrawal timing matrix | T06 |
| R10 | Ownership/permission isolation, server guards and no bypass via legacy writes | T03,T04,T08 |
| R11 | Both actual AI clients authenticate, discover modules and save equivalent drafts | T08,T09 |
| R12 | AI disconnect leaves runtime fully operable with zero LLM dependencies | T09 |
| R13 | Existing mobile-browser flows plus accessible review/admin screens | T07,T09 |
| R14 | Migration rehearsal, regression evidence and reviewed release/rollback | T00,T10 |

ACCEPTANCE-TESTS.md expands these into fixtures and observed outcomes. No requirement is satisfied merely by the existence of a component, SQL file or mocked connector.

## 13. Delivery and evidence

Build the first complete eight-team doubles workflow before broadening to all combinations. Test invalid configuration and domain invariants at unit level, concurrency/permissions against Postgres with real role contexts, and the complete UI against staging. Demonstrate the chosen Claude connection with the actual account; keep ChatGPT onboarding as a follow-up.

Definition of implemented: application builds, targeted tests pass, all R01–R14 staging criteria are evidenced and residual limitations are stated. Definition of released: the reviewed named migration and deployment are authorized and applied, then the actual deployment URL passes smoke tests. Do not conflate implementation, staging evidence and production availability.

No new delivery-duration estimate is asserted. The older 11–17 engineer-week estimate already assumed reuse. Re-estimate after baseline discovery and the first complete workflow, using actual work remaining.

## 14. Changes from the older PRD

This MVP keeps the old product boundary and supported basic formats while simplifying storage and execution: one-person teams for singles, match score columns for one-game matches, short transactional progression, immediate registration opening, no scheduled worker/outbox, and existing owner/admin/player roles. These reductions remove general infrastructure without weakening permission, atomicity, revision, correction or audit requirements.

The old source document remains at `C:/Users/Eduardo/Downloads/Scotting Revenue engine/outputs/picktennt-tournament-prd-v2/PRD.md`. It is historical input; this project folder's version 3.0 controls the new MVP build.
# October 28 administrator-assistant scope update

The administrator requests full tournament administration through Claude/ChatGPT, with explicit impact confirmation before structural changes. See [ADMIN-ASSISTANT-REQUIREMENTS.md](ADMIN-ASSISTANT-REQUIREMENTS.md) for the accepted requirement and current deployment limitations. This supersedes draft-only as the target product scope. Routine administration is released; owner scope and administrator-management migrations 009/010 are applied to the database; their application release and live acceptance remain pending.


### October 28 implementation update
All players must use existing Picktennt profiles. Website administrators and assistants with explicit tournaments:admin consent may enroll those profiles, preserving their account/DUPR links and recording administrator admission separately from personal consent. Name-only guest creation is disabled. Routine MCP administration now shares the command engine with the website; structural changes require confirmation and current impact/revision checks. Owner publication, cancellation, completed-result reopening and administrator add/remove require current ownership, a current impact/revision preview and explicit confirmation. Connectors require newly consented tournaments:owner mapped to owner:manage; routine administrator scope does not grant owner authority. SQL 009/010 and corresponding tools/UI must be verified and deployed before claiming release. Actual external-client acceptance is tracked in BUILD-STATUS.md.
