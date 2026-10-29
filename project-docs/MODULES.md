# Picktennt modular tournament MVP: module contracts

**Version note:** This document specifies version 1's original linear MVP. The newer local version 2 composition model is documented in [COMPOSABLE-BLOCKS.md](COMPOSABLE-BLOCKS.md); its group and branching support supersedes the exclusions below only for version 2 definitions. Version 1 remains unchanged.

Status: implementation specification, 28 October 2026. No application implementation or deployment is authorized by this document. Select implementation/review models after reviewing this package and before source changes.

## 1. Scope and authority

Use the existing Next.js/Supabase application at `C:/Users/Eduardo/picktennt-backend`, after verifying deployed repository/commit and production schema. Preserve existing account, tournament, team, match and invitation IDs. This review is local evidence only.

Read alongside the authoritative [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [MVP-reuse-plan.md](MVP-reuse-plan.md). The original [PRD sections 5-12](<C:/Users/Eduardo/Downloads/Scotting Revenue engine/outputs/picktennt-tournament-prd-v2/PRD.md>) are historical input. The bounded decisions below narrow that document; do not implement its larger architecture by implication.

Support singles/fixed doubles, 2-16 entries, one game per match, one venue and 1-8 courts. A singles entry is an existing `teams` row with one member; doubles has two. `matches` is the canonical one-game result record. No parallel writable score store, rotating partners, groups, arbitrary graphs or custom formulas.

Three responsibilities remain separate:

- The **implementation agent** builds the catalog, server services, database guards and website additions. It does not execute production migrations without release authorization in the parent plan.
- The **organizer's assistant** in ChatGPT/Claude discovers capabilities, asks missing questions, saves/validates drafts and returns the website review link. It cannot publish, invent executable modules, approve consent or supply authoritative outcomes.
- The **Picktennt runtime** authenticates, persists facts, calculates consequences and serves the website independently of any LLM, connector or open conversation.

## 2. Definition and composition

The persisted engine discriminator is `modular_v1`; the definition has `schema_version: "1.0"`. Keep engine on the event/runtime envelope, rather than adding an undocumented definition field. Top-level definition keys are exactly `schema_version`, `event`, `registration`, `policies`, `scheduling`, `nodes`, following original `example-definition.json` vocabulary.

| Object | Fields and constraints |
|---|---|
| `event` | `name` 1-120 trimmed characters, `venue_name` 1-200; `starts_at`, `expected_end_at` absolute instants with resolved offsets consistent with IANA `timezone`; end after start; `visibility: public|unlisted`; integer `courts` 1-8 |
| `registration` | `mode: open|approval`, `entry_type: singles|fixed_doubles`, `max_entries`, `min_entries` (integers 2-16, min <= max), `closes_at` <= start and future at publication, `partner_consent` true for doubles/false for singles, `organizer_plays` explicit boolean |
| `policies.match` | `version: 1`, `games: 1`, `target: 11|15|21`, `win_by: 1|2`, `cap: null`, `scoring: side_out|rally` |
| `policies.ranking` | `version: 1`, `order`, `final_tie: recorded_draw`; order starts `wins_desc`, then unique supported secondary fields |
| Other `policies` | `confirmation: opponent_or_admin_v1`, `withdrawal: stage_sensitive_v1`, `correction: impact_review_void_and_replay_v1` |
| `scheduling` | Integer `estimated_slot_minutes` 5-120, integer `minimum_rest_minutes` 0-30 and < slot, integer `contingency_minutes` 0-240. Slot includes rest/transition allowance; warn on insufficient venue window |
| `nodes[]` | 4-7 nodes; unique stable `id` 1-40 characters matching [a-zA-Z0-9_-], pinned `module`, optional `from` naming one upstream ID, optional `config`; first has no `from`, every later node exactly one; omitted config means `{}` |

Only these complete ordered linear patterns are legal (every module name has suffix `@1`):

1. `registration > entries > round_robin > standings > placements`
2. `registration > entries > elimination > placements`
3. `registration > entries > round_robin > standings > qualify > elimination > placements`

Reject extra/repeated nodes, arbitrary edges, cycles, disconnections, multiple inputs, unknown fields/versions, incompatible ports and multiple terminal outcomes. Node order and `from` must describe the same chain. Pin module/policy versions at publication; deployments cannot silently reinterpret active versions.

Validation issues return field/node paths plus `MISSING_FIELD`, `UNSUPPORTED_MODULE`, `UNSUPPORTED_RULE`, `INCOMPATIBLE_CONNECTION`, `INVALID_CAPACITY`, `INVALID_ADVANCEMENT` or `RESOURCE_CONFLICT`, with supported alternatives. The containing command error uses INVALID_DEFINITION or MISSING_FIELDS as specified in ARCHITECTURE.md; these are not interchangeable with per-field codes. Refuse an unsupported request rather than dropping it. Ambiguous local daylight-saving times require an explicitly resolved offset in the completed definition; partial drafts may preserve unresolved input with a missing-field issue.

Only module settings are `qualify.config.count: 2|4` and `elimination.config: { seeding: "draw"|"ranked", bronze: boolean }`. Direct entries -> elimination uses `draw`, generated/persisted once at roster lock; qualify -> elimination uses `ranked`. The original playoff example correctly retains `ranked`. Other configs are empty; shared rules stay in the top-level objects.

Publication validates capacity without requiring real registrants. Lock/start checks actual eligible roster: direct elimination exactly 2/4/8/16; RR 2-16; qualification at least count. Published definitions are immutable even before play. Changed rules/structure require a separate draft/event, not an amendment feature in this MVP.

## 3. Shared types, execution and integrity

These are conceptual contracts, not generated production TypeScript. Outputs are server-produced references, never authoritative model/client arrays.

- `ExecutionSnapshot`: one event's definition/version, tournament revision, roster revision, result revision, stages, matches/outcomes, permissions and protected operation history.
- `OutputEnvelope<T>`: `tournament_id`, `definition_version`, `producer_node_id`, `data_revision`, `roster_revision`, `result_revision`, `completeness: provisional|complete`, stable data references. Every consumed output must match the same event/definition and compatible current roster/result revisions.
- `ApprovedParticipants`: admitted account/consent references; `EntrySet`: ordered team IDs, confirmed member IDs, eligibility, roster revision and seed provenance.
- `StageResults`: fixture/current accepted-outcome references/exclusions; `RankedEntries`: metric rows/explanations, eligibility, equal-rank groups and recorded-draw references.
- `BracketResults`: fixture/outcome/slot provenance and exit groups; `FinalPlacements`: champion, rank groups, exclusions, source revisions and result version.
- `ModuleEvaluation`: stage state, optional typed output and proposed mutations for the enclosing transaction; modules never independently commit partial work.

Persist `tournament.modular_state: draft|registration_open|registration_closed|ready|active|completed|cancelled`. Existing `tournaments.status` is only the compatibility projection in the parent architecture. Stage states are `waiting|ready|completed|blocked`: waiting for human input is normal; blocked names an intervention. Failed transactions roll back and retry; no persisted `running/failed` workflow states.

Publication immediately opens registration. Check `closes_at` with server/database time on every admission; reject expired admission even if visible lifecycle has not advanced. Organizer explicitly closes, locks, approves fixture materialization and starts. Start time/refetch does not start play. Completion automatically follows terminal contracts.

Short authenticated commands read a bounded snapshot, compute affected modules and atomically commit facts plus progression in PostgreSQL at the expected tournament revision. Never keep HTTP open for scores. No long-running agent, worker, outbox, queue, generalized workflow library or scheduled jobs for MVP. If bounds exceed command limits, escalate architecture before adding any of these.

Every mutation has `operation_id` and `expected_revision`, except new-resource creation has no existing revision. Scope operation uniqueness to actor/resource; retain canonical request hash, receipt and committed revision. Replaying identical payload returns its original receipt; reusing ID with changed payload conflicts. Recheck current authentication, event ownership/role and connector grant **before cached receipts**. Fresh operations at stale revision conflict without writes.

Publication requires signed-in owner review of current draft revision/configuration hash. The command sends expected_revision, reviewed_definition_hash and acknowledged warning codes; the server recomputes and compares them. Atomically pin rules, open registration and create the event runtime; a concurrent draft edit invalidates review. The organizer's assistant returns the review link; no MCP publication/operational tool or model-supplied `confirmed=true` grants permission.

Derive actor from session/token; never trust client actor, owner, role, consent, accepted winner, champion, revisions or eligibility. Resource IDs are references only: stages, teams, members, rounds, matches, previews, draws and bracket-next links must belong to the same event/definition. Back application validation with FK/uniqueness/transactional guards and RLS.

Roles: owner publishes/cancels/reopens and manages existing admin access; admin handles admissions/start/disputes/corrections/withdrawals; player requests entry, submits own scores and confirms opposing submissions. No new scorekeeper/ownership-transfer workflow. Revocation applies to the next command, including retries. Web and connector draft actions share services.

Persist fixture logical identities per event/stage/roster/materialization revision. Retries reuse committed fixture IDs and seed/draw decisions. Realtime refreshes displays; reconnect refetches authoritative data. Provisional output cannot advance downstream nodes.

## 4. Shared competition and intervention rules

Played scores: distinct nonnegative integers. Target T/win-by-one requires winner=T, loser<T. Win-by-two requires winner=T with margin>=2, or winner>T with margin=2; no cap. At T11/win2: 11-9,12-10,15-13 valid; 11-10,12-8, negatives, fractions and ties invalid. Side-out/rally does not change final-score validation.

Keep legacy `Match.status` such as `in_progress`, `score_entered`, `validated`, `disputed`; add separate `outcome_kind: played|walkover|retirement|no_contest` and accepted/current provenance. Do not replace statuses with PRD-only `submitted/resolved`, or infer advancement from legacy `walkover` alone.

`startMatch`, by an own participant or admin while event active, claims its assigned court after checking resolved feeders, two eligible sides, no active match on that court or involving any shared player, and `ready_at`. For each player, physical rest runs from previous played/retirement `ended_at` + minimum rest. Walkover/no-contest requires no physical rest. Preview times are estimates; Start checks current facts without a timer worker.

Modular played score submission requires `in_progress`. Set `ended_at` using server time on submission/adjudication for played/retirement; release active court on finish submission. Unconfirmed outcomes still block their successor matches. Preserve submitted and adjudicated timestamps/history rather than trusting a model-provided end time.

Only accepted current outcomes count. Identify submitting entry from membership; submitter/partner cannot confirm. Only actual opposite member may confirm; admin authority uses explicit reasoned override, including a playing admin. Proposed/disputed outcomes cannot advance. Competing submissions at the same match/event revision conflict.

Played contributes wins/losses and points. Walkover/retirement gives explicit win/loss without invented points; retirement partial score is informational. No-contest gives neither wins/losses nor points. Winner is an eligible participant or explicit walkover against empty slot; never fabricate played 11-0.

Ranking default: `wins_desc,differential_desc,points_for_desc`. Other selectable secondary keys: `points_against_asc`, `points_for_in_losses_desc`; wins stays first, duplicates invalid. Explain metrics. Exact ties have equal provisional ranks, never ID/insertion-order fallback. `recorded_draw` requires explicit admin action persisting one permutation of the **whole tied group at that ranking revision**, shared by champion, qualifier and seed decisions. Changed group/input revision needs a fresh explicit draw; retry never redraws.

Withdrawal concerns the whole entry; record generic reason, actor, stage and time; retain accounts, teams, matches and history. Before lock cancel/release capacity. After lock before first play, obsolete affected schedule, return to roster review and relock/rematerialize under immutable rules. Reject initial start with <2 eligible or unsupported direct-bracket count.

For an in-progress match, withdrawal atomically records retirement with the eligible opponent as winner, records ended_at and releases the court; both sides ineligible yields no-contest. Apply incomplete-RR exclusion afterward for rankings. Cancellation releases active claims without creating played winners.

During incomplete RR exclude **all** outcomes involving the withdrawn entry from that stage ranking; preserve facts, make future matches no-contest and remove eligibility. Determine completion for the **whole stage**, including unconfirmed/disputed results, not that player's scheduled fixtures. Completed RR preserves results after withdrawal.

After completed RR, before **any** playoff starts, replace withdrawn qualifier with next eligible ranked entry and rematerialize affected unstarted fixtures; no replacement means an empty slot/walkover. After any playoff starts, no replacements. Elimination: one eligible side advances by walkover; both ineligible produce no-contest/empty successor. No eligible champion means blocked placements and owner cancellation with no winner.

Correction requires impact preview, current revision and reason. Preview includes standings/draw validity, qualifiers, dependent fixtures and placements; stale preview commits nothing. Unstarted affected dependents are rematerialized with history preserved; unaffected fixtures remain. Started/resolved affected dependents block until explicit void-and-replay invalidates affected results, preserves history, restores participants and schedules replay. Owner can reopen completed event; placements become under review until new result version. No bulk-delete-rounds shortcut or rule editing.

## 5. `registration@1`

**Purpose/ports:** account applications, approvals and consent -> `OutputEnvelope<ApprovedParticipants>`. Published stage waits for explicit closure/lock; visiting an invitation is never mutation.

**Config/questions:** empty config; read `registration` and timing. Ask singles/fixed pairs, min/max entries, open/approval, deadline/timezone, consent and organizer participation. Normalize “16 players, fixed doubles” to eight entries/16 player slots; ask fixed versus rotating if unclear, and explain rotating unsupported. Never infer venue/time/consent.

**Preconditions/reuse:** published immutable definition, authenticated Join/rules acceptance, admission window, no conflicting active membership. Reuse `profiles`, `tournament_players`, `teams`, `team_members`, auth and join links. Add consent/request metadata where absent; legacy pending/approved/rejected alone cannot represent full proposal lifecycle.

**Commands/completion:** join/propose partner/accept/cancel/approve/reject/close/lock. Only complete approved entries consume capacity; pending/incomplete reserve nothing. Partner acceptance admits in open mode; admin approval admits in approval mode. Serialize capacity and consent/membership writes atomically. Close/lock produces complete participant output.

**Retries/revisions:** shared receipt/CAS; repeated consent never duplicates membership. Last-slot concurrency admits at most one entry. Past deadline, authorized committed replay may return receipt; a new admission fails even from an old page.

**Corrections/withdrawal:** before lock release slot; changing partner withdraws old proposal and needs actual new consent. After lock use whole-entry withdrawal/roster-review; never edit published admission rules.

**Example:** seven of eight pairs approved; two complete pending pairs race for last slot. Exactly one admitted eighth; other stays pending with `CAPACITY_FULL`, without partial approval. GET `/join/<code>` writes nothing.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/registration.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/registration.test.ts`; existing admission surfaces call shared commands.

**Tests:** GET versus Join; last-slot race; deadline; operation replay/revoked retry; partner impersonation; organizer nonplayer; cross-event consent/team; no capacity reservation by pending proposals.

## 6. `entries@1`

**Purpose/ports:** `ApprovedParticipants` -> complete locked `OutputEnvelope<EntrySet>` retaining stable team IDs, consenting rosters, seed source and roster revision.

**Config/questions:** empty config; read entry type/min/max. Ask to resolve incomplete pairs/check-in. Explain direct-bracket actual count restriction. Direct seeding is a persisted random draw at lock, shown in review; it is not the organizer's assistant choosing favorite seeds.

**Preconditions/reuse:** registration closed; approved/consenting accounts; correct roster size one/two; one active entry per player; count within min/max. Direct bracket actual 2/4/8/16; RR 2-16; qualification count <= roster. All memberships same event. Reuse `teams`/`team_members`; no second entry identity or name/email-based account claims.

**Commands/completion:** owner/admin lock records roster revision and, for direct bracket, one draw order. Complete output makes competition ready for approved schedule materialization. Event ready requires committed initial fixtures/checks; explicit Start remains required.

**Retries/revisions:** lock binds exact roster/event revision; concurrent withdrawal/consent change invalidates preview. Retry returns original teams, roster and seed permutation; cannot create fresh singles teams or redraw.

**Corrections/withdrawal:** before play obsolete affected fixtures and relock; after play rosters frozen, one doubles withdrawal makes pair ineligible. Preserve prior lock/consent/draw versions.

**Example:** A-D singles reuse four one-member teams. Six actual teams in direct bracket with min4/max8 fail `INVALID_CAPACITY`; fill eight or explicit withdrawals reduce four. Do not change published rules or evict entries automatically. Four-team draw B,D,A,C is stable on retry.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/entries.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/entries.test.ts`; adapt current roster/team picker.

**Tests:** singles reuse; two actual consents; duplicate/cross-event membership; actual counts 1/2/3/4/6/8/16/17; stale lock; whole pair withdrawal; identical IDs/draw on retry.

## 7. `round_robin@1`

**Purpose/ports:** locked `EntrySet` -> `OutputEnvelope<StageResults>` for one full all-play-all group. Interim results may display provisionally but cannot feed complete qualification/placements.

**Config/questions:** empty config; inherit courts/scoring/scheduling. Explain N(N-1)/2 fixtures, one match versus each opponent; no groups or games-per-player truncation. Review duration warnings/fixture preview, with no untimed-game finish guarantee.

**Preconditions/reuse:** 2-16 eligible locked entries; committed fixtures, event active before play. Reuse `lib/tournament/round-robin.ts::generateRoundRobinSchedule`, `rounds`, `matches`. Logical stage differs from court waves. Odd-count bye is internal, never played/walkover fixture. Adapt schedule for 1..courts, player/court conflicts and physical rest; existing generator alone is not a wall-clock scheduler.

**Commands/completion:** materialization persists fixtures; `startMatch` claims court/rest; submission waits for opposing confirmation/admin adjudication. Accepted outcomes and affected projections commit together. Complete when every required fixture has accepted terminal outcome and no dispute. Final acceptance feeds standings without LLM/background process.

**Retries/revisions:** unique pair per stage/roster revision; stale schedule commits nothing. Repeated confirmation cannot count points twice. Failure rolls back accepted outcome plus any next-stage mutation; no half-materialized playoffs.

**Corrections/withdrawal:** incomplete stage excludes every withdrawn-entry result and future no-contests; completed stage preserves facts in ranking. Correction preview identifies any downstream seed/draw consequence. Do not truncate competition or delete rounds to repair one match.

**Example:** A/B/C, one court -> AB,AC,BC once each, three matches/two per entry. A withdraws while BC unresolved: AB/AC facts retained but excluded, unplayed A matches no-contest, ranking uses BC only. If all three accepted before withdrawal, preserve AB/AC ranking instead.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/round-robin.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/round-robin.test.ts`; wrap generator without altering legacy formats.

**Tests:** N2-16/courts1-8 gives all unique N(N-1)/2 pairs, no self/bye match; bounded courts/rest; fake-clock start conflicts; no truncation; disputed final blocks; atomic retry; whole-stage withdrawal boundary/history.

## 8. `standings@1`

**Purpose/ports:** `StageResults` -> `OutputEnvelope<RankedEntries>` with metrics/eligibility/tie groups. Complete input and ordering required by downstream contract determine completeness; unresolved required ordering blocks.

**Config/questions:** empty config; ask supported tie order and show wins/differential/points-for default plus explicit draw policy. Do not offer head-to-head/custom formulas or hidden ID fallback. Preview must show executable keys, not only free-text rules.

**Preconditions/reuse:** same-event RR references; exclude superseded/unaccepted/excluded results. Initialize rows from full locked roster, including zero-result entrants. Reuse metric concepts in `lib/tournament/standings.ts`, through versioned modular policy adapter. Existing comparator/half-win handling do not satisfy this contract. Rebuild existing `standings` projection with stage/input revision provenance.

**Commands/completion:** outcome acceptance/adjudication/withdrawal/correction recomputes metrics. Complete RR plus resolved required ordering completes this module. Exact ties needing champion/cutoff/seed order produce blocked “Record draw” action. Explicit admin command persists permutation for whole tied group/revision and recomputes all dependents atomically.

**Retries/revisions:** identical inputs produce metric groups; draw replay returns stored permutation. Concurrent correction invalidates stale draw request/preview. Never generate randomness on read/render or separately for each consuming stage.

**Corrections/withdrawal:** changed accepted input invalidates dependent outputs/stale draw provenance; completed-RR withdrawal retains metrics but changes eligibility. Incomplete-RR exclusion removes both sides' stats for involved matches. Shared downstream correction restrictions apply.

**Example:** A/B each two wins, differential+5, points-for25 -> equal provisional rank; champion/cutoff blocked. Admin draw at revision31 stores B,A for all downstream decisions; same operation returns B,A. Later correction recomputes ranking before any new required draw; it cannot use old ordering blindly.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/standings.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/standings.test.ts`; preserve legacy `computeStandings` outside modular events.

**Tests:** default/alternate orders; wins first; zero-result rows; no half wins; played-only points; administrative win/null points; provisional/disputed exclusion; tied-group concurrency/replay; no GET draw; completed-stage withdrawal boundary.

## 9. `qualify@1`

**Purpose/ports:** complete `RankedEntries` -> ordered `OutputEnvelope<EntrySet>` of top two/four eligible entries, retaining team IDs, ranking/roster/result revisions and seed provenance.

**Config/questions:** required `config.count: 2|4`; ask when missing. Explain entries versus player count and eligible count. Never infer top four from four courts/eight teams.

**Preconditions/reuse:** completed same-event RR/standings, enough eligible entries, all cutoff/playoff seed ordering resolved. Select eligible rows once in rank order. Reuse teams/standings; legacy `advancement_count`/`finals_format` may project compatibility but cannot override definition authority.

**Commands/completion:** standings completion/explicit tie resolution selects entrants and materializes dependent bracket atomically. A ranking display cannot advance provisional top N. Complete output carries ranking and eligibility provenance.

**Retries/revisions:** unique entry/position per output; same operation cannot create duplicate semifinals or entrant. Stale revision recomputes current standings; no authoritative assistant-written qualifier list.

**Corrections/withdrawal:** before any playoff starts replace withdrawn qualifier by next eligible completed-ranking entry and rebuild affected unstarted fixtures. Without replacement propagate empty slot/walkover. After any playoff starts no backfill. Score corrections affecting a started dependent require preview/void-and-replay.

**Example:** ranking A,B,C,D,E, top4: C withdraws before playoffs -> A,B,D,E with revised seeds/history. After one semifinal starts, E is not admitted; C's next opponent advances by walkover. A C/D/E multiway tie crossing fourth requires whole-group draw before selection.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/qualify.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/qualify.test.ts`; consume shared ranking instead of duplicating comparator.

**Tests:** count2/4; insufficient eligible; exact cutoff/multiway seed ties; duplicate prevention; stale revision; before/after-first-playoff withdrawal; empty replacement slot; correction into started fixture blocks.

## 10. `elimination@1`

**Purpose/ports:** locked/qualified `EntrySet` -> `OutputEnvelope<BracketResults>` for single elimination, required final/optional bronze. Stable slot provenance connects accepted winners/losers to successors.

**Config/questions:** required `seeding: draw|ranked`, `bronze: boolean`; direct input requires draw, qualifier input ranked. Ask whether bronze is played; explain no-bronze shared third/earlier exit groups. For two entrants reject bronze=true: no semifinal losers; do not discard silently. Direct draw is generated once at lock, displayed in preview and preserved on retry.

**Preconditions/reuse:** direct actual2/4/8/16 or qualified2/4; immutable rules, seed decisions resolved, same-event entries and approved preview. Reuse `lib/tournament/bracket.ts::buildBracket` topology and existing bracket links via adapter. Its unconditional bronze, court numbering and adjacent winner wiring need adaptation/verification. Use scheduler rather than court index per fixture.

Ranked seed leaf order protects top seeds until final: 4 -> `[1,4,2,3]`; 8 -> `[1,8,4,5,2,7,3,6]`; 16 -> `[1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]`. Adjacent leaf pairs are first-round matches; adjacent winners feed next round. Draw mode maps persisted random seed order into these positions. Raw 8-team pairs `1v8,2v7,...` wired to adjacent winners would put seeds1/2 together too early and are insufficient.

**Commands/completion:** materialization/Start enables play; `startMatch` enforces court/dependencies/rest. Accepted outcomes fill appropriate successor once, schedule eligible successors and recompute complete state atomically. Wait for disputed/unconfirmed feeders. Required final plus bronze when enabled must resolve; no-contest is terminal without inventing winner.

**Retries/revisions:** logical fixture/slot keys reuse committed IDs, not freshly generated temporary IDs. Second confirmation cannot advance twice. CAS and event guards include bracket-next links. Failure rolls back accepted outcome and every successor write.

**Corrections/withdrawal:** replacement only before any playoff starts; later future walkover. Both withdrawn -> no-contest/empty slot; eligible opponent advances once. Changed feeder into started match blocks until explicit void-and-replay/history preservation. No eligible champion blocks completion.

**Example:** A/B/C/D seeds -> A-D,B-C semis. Bronze=false: three fixtures, final determines first/second, semi losers share third. Bronze=true: four, completion waits for bronze as well. One court plays gold/bronze in separate eligible waves. Both finalists ineligible -> no-contest/blocked placements; owner cancels without champion.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/elimination.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/elimination.test.ts`; adapt generator/scheduler, preserve unrelated legacy behavior.

**Tests:** 2/4/8/16; 2+bronze rejection; ranked seed paths1/2 meet only in final; persisted draw replay; bronze on/off; one-court waves; court/player/rest conflicts; no duplicate fill; empty propagation; disputes; wrong-event links; started-dependent correction.

Fixture-count expectations with all entrants eligible: two -> one final; four -> three plus optional bronze; eight -> seven plus optional bronze; sixteen -> fifteen plus optional bronze. Empty slots change accepted outcome kinds, not the committed bracket topology or fixture identity.

## 11. `placements@1`

**Purpose/ports:** complete `RankedEntries` (RR-only) or `BracketResults` -> `OutputEnvelope<FinalPlacements>`. This sole terminal node owns modular champion/public-result authority.

**Config/questions:** empty config; explain composition/bronze placement rules before publication. If RR final tie blocks, request explicit administrative draw action. No custom rank formula or model-supplied winner.

**Preconditions/computation:** complete same-event input, no dispute/tie affecting declared outcomes, eligible champion, required final/bronze accepted. RR: first eligible resolved rank is champion; others follow ranking. Bracket: final winner/loser first/second; bronze winner/loser third/fourth, otherwise semis share third. Earlier losers share exit-round groups. RR nonqualifiers keep RR order below playoff places. Identify withdrawn/excluded entries explicitly.

**Reuse:** adapt `lib/tournament/standings.ts::computeBracketFinishPositions` and results UI; its sequential lower ranks and score-derived winner fallback are not authoritative for modular grouped/administrative results. Retain event/standing IDs and add only missing grouped-result/version provenance.

**Commands/completion:** terminal acceptance/tie resolution atomically publishes consistent result version and sets event completed. Rendering/refetch reads that version; AI disconnect is irrelevant. No champion -> blocked; owner cancellation records no champion and retains history.

**Retries/revisions:** one current result version per committed input revision; repeat operation returns original completion receipt. Never publish older projection over newer result. Public result identifies definition/data/roster/result revisions.

**Corrections/withdrawal:** owner reopens completed event for correction; old placements under review/historical, new version publishes only after dependencies resolve. Never directly edit champion. Completed-RR withdrawal preserves stats; eligibility/outcome consequences still follow explicit policy.

**Example:** top4/no bronze, A beats B, C/D semi losers -> A1,B2,C/D shared3, RR fifth E stays5. Do not rank C/D by seed. Owner reopens completed final correction; after preview/adjudication B1,A2 publishes as a new result, with prior result retained.

**Files:** proposed `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/modules/placements.ts` and `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/tests/tournament-builder/placements.test.ts`; version-aware existing results projection.

**Tests:** RR tie/draw; two-entry final; bronze on/off; exit groups/nonqualifier order; administrative winner without score; no-champion cancellation; completed reopen/history; duplicate terminal operation; cross-event upstream rejection.

## 12. Implementation handoff and acceptance

Proposed shared files in `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app/lib/tournament-builder/`: `types.ts` for envelopes/snapshots; `catalog.ts` for seven descriptors/questions; `definition.ts` for strict schema and `validate.ts` for graph/configuration validation; `commands.ts` for permission/operation/revision orchestration; `runtime.ts` for bounded progression; `policies.ts` for scoring/ranking/interventions. Keep atomicity in one reviewed PostgreSQL boundary; exact migrations follow production inventory. No workflow framework for seven cases.

Each descriptor declares ID/version, description/schema, typed input/output, permitted neighbors/cardinality, entry types, preconditions/completion, question metadata, corrections and examples. Shared server commands enforce these contracts; descriptors/instructions alone do not.

Before implementation select models for inventory, coding and independent review; verify deployed baseline/staging. Local branch/SQL/docs are not production evidence. Start with fixed-doubles RR -> top4 -> playoffs, preserving legacy/mobile session paths. Source changes and runnable test-runner decisions belong to implementation, not this document.

Acceptance covers all three patterns, singles/doubles, boundary entries/courts, stale commands, revoked retries, last-slot concurrency, stable draws/seeds, actual opposite confirmation, legal scores, court/rest start enforcement, rollback, withdrawal and correction history. Use appropriate existing/module tests with repository's verified runner, not an assumed new test framework. Fake clock advances physical rest in tests; no timed worker. Demonstrate 16 players/eight teams from publication to completion in website after AI disconnect, including dispute, correction and withdrawal.

Original-PRD differences are explicit: no worker/outbox/jobs; no running/failed stage states; no scheduled registration opening; no published-rule amendments; no scorekeeper/ownership transfer; direct seeding draw versus qualified ranked; no separate entry/game tables required. Older parent-plan wording about authorized new definition versions must be read as superseded by immutable published events; operational roster/result history is not rule editing.

Source hazards needing scoped adapters/tests: standings fixed comparator/dropped zero-result rows/half-win ties; bracket unconditional bronze/court overflow/seed wiring; player removal scheduled-only/per-player completion tests and destructive nontransactional writes; existing confirmation/outcome handling alone does not enforce these policies. Preserve legacy behavior unless explicitly approved shared fix is necessary, covering its regression boundary.
