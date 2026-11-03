# Picktennt modular tournament MVP — reuse and delivery plan

Initial assessment prepared 28 October 2026. The baseline and delivery sections below are historical planning evidence, not current claims that implementation/source/production remain unverified. The feature is implemented in app/ and routine administration is released; current named migration, deployment and acceptance facts are in [BUILD-STATUS.md](BUILD-STATUS.md). Migrations 009/010 are database-applied while their owner application release is pending.

Project update: [PRD.md](PRD.md) version 3.0 is now the main specification in this folder. [START-HERE.md](START-HERE.md) indexes the module contracts, architecture, execution tasks and tests. The original v2 PRD remains historical input.

## Product outcome

An organizer connects Picktennt to ChatGPT or Claude, describes a tournament, answers missing configuration questions, and receives a saved draft. Picktennt validates the requested module combination and shows a review page. The current owner publishes through the website or an explicitly reviewed/confirmed owner-scoped assistant action. The chosen client is Claude (ChatGPT OR Claude, not a two-client gate). Routine and owner scopes follow current account roles; no rest or separate Start game is required, and all new entries reference real profiles with consent distinct from administrator admission. Picktennt then operates the event, including registration, score confirmation, standings, qualification, corrections and withdrawals, independently of the AI connection.

Build this inside the existing Next.js/Supabase application. Preserve existing account IDs, tournament IDs, team IDs and invitation links.

## Historical initial assessment: evidence and baseline

- Reviewed source: `C:/Users/Eduardo/picktennt-backend`.
- Current local branch: `codex/session-games`; HEAD `d3821bd` (23 September 2026).
- Existing local changes: modified `scripts/test-session-games.mjs`, untracked `supabase/migrations/013_session_games_v2.sql`, and untracked Supabase temporary files. Preserve these during implementation; the migration is not evidence of a production deployment.
- Another checkout exists at `C:/Users/Eduardo/coding/picktennt`. Its package and migration inventory differ. The inspected backend declares Next.js 16.3.6; the second copy declares 16.2.4.
- Local source and migration definitions were inspected. The active Vercel deployment, production Supabase schema, policies and applied migrations have not been verified in this assessment.
- The first engineering task is to map the actual deployment to its repository/commit and Supabase project, then select the development baseline. Do not infer this from directory names or a local branch.

## Reuse map

| Existing asset | MVP use | Required adaptation |
|---|---|---|
| Supabase Auth, `profiles`, login and auth callback/confirmation routes | Same player and organizer accounts, Google sign-in and existing confirmation handling | Add delegated connector consent and permissions using the same identity |
| `tournaments`, creation API and tournament pages | Event identity, title, dates, courts, discovery, join code and lifecycle | Add definition/version references, timezone, revision and validated publication |
| `tournament_admins` and administrator controls | Ownership and event administration | Enforce command permissions on the server; distinguish organizing from playing |
| `tournament_players`, join button and join-code route | Registration, pending/approved states and membership | Explicit join action, deadline/capacity enforcement and consistent consent |
| `teams`, `team_members`, team picker | Fixed doubles and singles entries | Preserve the existing one-player-team representation for singles; enforce roster size and partner consent |
| `rounds`, `matches`, match pages | Persisted fixtures, scores, court assignments and bracket links | Add stage/fixture identity, revisions, score legality and transactional updates |
| Score entry, validation and dispute UI | Familiar player and administrator flow | Route writes through shared backend commands and correct opponent identification |
| `standings` and `lib/tournament/standings.ts` | Rankings and final placements | Support the chosen versioned ranking policy and explicit cutoff ties; include eligible entries with no results |
| `lib/tournament/round-robin.ts` | Pair generation | Verify even/odd roster and court constraints with tournament fixtures |
| `lib/tournament/bracket.ts` | Elimination generation and advancement links | Verify seeding/court behavior; make third-place behavior match the chosen configuration |
| `lib/tournament/player-removal.ts` and removal dialogs | Withdrawal, retirement and walkover concepts | Apply a documented stage-sensitive policy atomically and preserve history |
| Session-game operation IDs, revision checks and locking patterns | Design precedent for retry-safe commands | Reuse the pattern after verification; keep tournament operations separate from mobile session contracts |
| Existing website layout, UI components and deployment | Organizer/player experience | Add draft review, connection management and stage progress within current navigation |

These are reuse candidates supported by source inspection, not a claim that every path is correct or deployed.

## Proposed first MVP scope

Use the PRD's bounded tournament scope: singles and fixed doubles, 2–16 entries, one game per match, one venue and 1–8 courts. Support these three compositions:

1. Registration → entries → round robin → standings → winner.
2. Registration → entries → elimination → winner, for supported bracket sizes.
3. Registration → entries → round robin → standings → top 2 or top 4 → playoffs → winner.

Choose scoring from supported values: 11/15/21 target points, win by one/two, and explicit scoring mode. Define ranking, exact ties, withdrawal and correction behavior before publication. The PRD's example ranking differs from current code; preserve existing-event behavior and version any new policy.

Creation tools must discover actual supported modules, report missing fields, and explain conflicting or unsupported requests. Start with a readable workflow preview. A drag-and-drop editor, new executable AI-generated modules, seasons, payments and rotating-partner tournament composition are later additions.

The 2–16-entry and format limits are proposed MVP limits from the PRD, not measured production limits.

## What to add

### 1. A module catalog and saved definition

Keep a small versioned catalog in application code: registration, entries, round robin, standings, qualification, elimination and placements. Scoring/confirmation are shared policies used by the relevant stages. Each module declares inputs, outputs, allowed settings, required questions and compatibility rules.

Save the selected modules and connections as a structured definition. Validation must independently reject incomplete rosters, invalid qualifier counts, incompatible connections and missing tie policies. Published definitions are immutable. The MVP permits operational corrections with preserved history, but no published rule-editing feature; alternative rule versions require a future supported amendment flow.

### 2. Shared backend commands

Website actions and the MCP adapter call the same domain services. Commands cover draft creation/update, validation, publication, joining, partner consent, admission, roster locking, schedule creation, score submission/confirmation/dispute, correction and withdrawal.

Every write checks the authenticated actor, event permissions, lifecycle and expected revision. Repeated requests return the original result instead of duplicating teams, matches or stages. Database transactions commit related changes together.

Existing direct writes must not bypass these commands for modular tournaments. An event has one authoritative mutation path. Route legacy and modular events explicitly while keeping their stored IDs stable.

### 3. Persistent stage progression

Picktennt advances from stored facts: approved roster → generated fixtures → accepted results → completed standings → qualified entries → playoffs → final placements. It must be able to resume after refresh/restart and must block qualification on unresolved disputes or cutoff ties.

PRD v3 selects short server commands with revision checks and an atomic commit of the result and dependent changes. Registration opens at publication, deadlines are checked on each admission, and an organizer closes/locks/starts explicitly. This replaces v2's general worker/outbox architecture for the bounded MVP. Request memory or an open browser cannot provide durability; if later scope introduces asynchronous processing, it requires a separately reviewed durable mechanism.

### 4. MCP and delegated access

Expose the PRD's creation tools: capabilities/modules, create/get/update draft, validate, preview, review link and operation status. Publication and tournament operation remain website actions for this MVP.

Reuse Supabase identities for connector authentication. Evaluate Supabase's OAuth server support, build the consent screen, and enforce application-level draft permissions and revocation. A working website login does not by itself give ChatGPT or Claude delegated access.

Validate the complete connection on both actual test accounts early. ChatGPT account/workspace permissions for write-capable custom MCP connections are an external dependency; a personal paid account alone is not sufficient evidence of eligibility.

### 5. Targeted website additions

- Draft review with chosen rules, workflow, missing decisions and preview counts.
- Publication of the reviewed definition revision.
- Stage progress and clear reasons an event is waiting or blocked.
- Correction impact preview and withdrawal consequences in existing admin flows.
- Connected-account permissions and disconnect action.

## Minimal database extension strategy

Retain the existing core tables and add only data that has no current home. Exact migrations depend on the production inventory.

| Proposed storage | Purpose |
|---|---|
| `tournament_definitions` | Draft/published configuration versions, module versions and approval metadata |
| `tournament_stages` | Logical stages, dependencies, execution state and input revision; existing rounds remain court waves/rounds within a stage |
| `tournament_operations` | Retry receipts and protected operation history with actor, request hash, revision, outcome and correction reason |
| Connector grants, where provider storage is insufficient | App permissions, tournament ownership checks and revocation |
| Additive columns/constraints on existing tables | Definition/stage references, revisions, fixture uniqueness, consent and roster invariants |

Use `teams` as entries and `matches` as the canonical one-game score record for this first scope. Separate `tournament_entries` and `match_games` tables from the full v2 PRD are not prerequisites if the verified schema supports these invariants. Preserve accepted score history through protected operation/result history. Never create two independently writable score sources.

No general-purpose module database is needed: descriptors belong in versioned application code. Add dedicated audit/result tables only where actual requirements cannot be met by the minimal design. PRD v3 adopts this simplified MVP; v2 remains available as historical context.

## Concrete source issues to address in the affected paths

1. Creation performs separate inserts for the tournament, player and teams. A later failure can leave a partially created event. Move this into an atomic command and make organizer participation an explicit setting.
2. The join-code page can enroll a logged-in visitor while rendering the page. Preserve invitation links but require an explicit join action with admission checks.
3. Score confirmation treats side B as the opponent regardless of `entered_by`. Resolve the submitting side and verify that confirmation comes from the other side or an authorized administrator.
4. Score submission, tournament status and bracket advancement use separate browser-driven writes. Move them under server enforcement, including score legality and downstream correction checks.
5. Schedule replacement deletes rounds before persisting the new schedule across several calls. Use a validated, transactional schedule commit; disallow destructive regeneration of played fixtures.
6. Standings currently use fixed wins/points-against/points-in-losses ordering. Written `rules_text` does not change that algorithm. Make supported policies executable and versioned.

## Build order and exit checks

| Step | Deliverable | Verification |
|---|---|---|
| 1 | Authoritative source/schema map and isolated development environment | Deployed commit/project, applied migrations and role-based access verified; existing work preserved |
| 2 | Minimal catalog, definition and validator; early connector authentication spike | Missing/invalid settings rejected; both clients can authenticate and access only their drafts |
| 3 | One end-to-end fixed-doubles workflow using current UI/tables | Publish, register, confirm teams, generate schedule, confirm scores, qualify and finish entirely in Picktennt |
| 4 | Shared command integrity and admin exceptions | Duplicate requests, concurrent last-slot joins, stale edits, disputes, corrections and withdrawals behave correctly |
| 5 | Remaining supported compositions and both MCP clients | Same definition semantics from web, ChatGPT and Claude; actual client onboarding demonstrated |
| 6 | Migration rehearsal and invited pilot | Existing login, links, tournament flows and mobile session contracts pass regression checks; release evidence reviewed |

Pilot fixture: 16 players, 8 fixed teams, round robin followed by top-four playoffs. Test the selected third-place policy explicitly. Disconnect AI after publication and finish the event, including one disputed/corrected score and one injured-team withdrawal. Repeat the creation flow with each AI client. No runtime calculation may need an LLM call.

## Remaining inputs and access

Engineering can start inventory and isolated implementation with the existing source and PRD. Before a functioning pilot, establish:

- The Vercel deployment → repository/commit → Supabase project mapping and access to inspect its schema/policies.
- A staging environment with test identities and representative tournament data.
- A test organizer account, player/opponent accounts and suitable ChatGPT and Claude accounts for connector validation. Use normal sign-in/consent; no passwords need to be sent in chat.
- Product decisions on the initial ranking policy, cutoff tie resolution, withdrawal outcomes and correction behavior after a downstream match starts. The PRD contains proposed defaults; review them using the pilot fixture.
- A pilot event/organizer and named release owner.

The previous 11–17 engineer-week PRD estimate already assumed reuse. This narrower storage/runtime approach needs baseline verification and a complete first workflow before a revised delivery estimate is credible.

## References

- [Existing PRD](<C:/Users/Eduardo/Downloads/Scotting Revenue engine/outputs/picktennt-tournament-prd-v2/PRD.md>)
- [Domain types](C:/Users/Eduardo/picktennt-backend/types/database.ts)
- [Initial schema](C:/Users/Eduardo/picktennt-backend/supabase/migrations/001_initial_schema.sql)
- [Creation API](C:/Users/Eduardo/picktennt-backend/app/api/tournaments/route.ts)
- [Score and confirmation UI](C:/Users/Eduardo/picktennt-backend/components/tournament/score-entry-button.tsx)
- [Scheduling persistence](C:/Users/Eduardo/picktennt-backend/lib/tournament/schedule.ts)
- [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [ChatGPT custom MCP connections](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [OpenAI custom MCP technical guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

External integration documentation was checked on 28 October 2026. Account eligibility and deployed configuration still require direct integration testing.
