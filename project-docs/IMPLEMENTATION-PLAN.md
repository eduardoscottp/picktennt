# Picktennt Tournament Builder Implementation Plan

> For agentic workers: use subagent-driven-development or executing-plans after the user's implementation-model selection. The coordinator supplies the complete assigned task and relevant contracts to each agent. Checkboxes track work; none of the implementation tasks below is complete yet.

**Goal:** Complete and verify the modular tournament MVP defined in PRD.md, reusing the existing Picktennt application.

**Architecture:** Existing Next.js/Supabase application with versioned module descriptors, strict saved definitions and shared authenticated commands. Short atomic database commits persist outcomes and dependent progression. Website and MCP use the same services; AI has no runtime responsibility.

**Tech stack:** Existing installed Next.js/React/TypeScript and Supabase/Postgres. T02 adds a minimal compatible Vitest test setup; T09 adds Playwright for browser tests if no suitable existing setup is found. Use the current lockfile and verify supported dependency versions when implementing.

This is the delivery task specification, with concrete contracts, files and expected tests. T00 must establish the actual baseline before agents write migration DDL or source patches. Each implementer turns its bounded task into small test/change/check steps using the inspected source; do not generate an entire speculative application from this document alone.

## 1. Source root and task boundaries

Documentation root is `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt`.

Proposed isolated application checkout is `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt/app`. In the task cards, paths beginning `app-root/` mean this exact checkout, not its Next.js `app/` subdirectory. T00 may select a different isolated path if required, but must record the absolute mapping before delegation. The original inspected root `C:/Users/Eduardo/picktennt-backend` remains shared source evidence until that verification.

Never run an existing integration script against its default credentials before checking which database it targets. All destructive fixture setup, migrations and test accounts belong in an isolated development/staging database. Production deployment is a separate final authorized step.

## 2. Model plan and bounded execution

| Work | Preferred model / effort | Reason |
|---|---|---|
| Coordinator, spec checks, dependency integration | gpt-6.1-sol / medium, high when resolving backend conflicts | Keep one compact task/evidence view |
| Schema/contracts and pure module adapters | gpt-6.1-sol / medium | Detailed interfaces and fixtures make work bounded |
| Database transactions, auth, corrections and multi-file integration | gpt-6.1-sol / high | Requires reasoning across state and permissions |
| Pure display/fixture tasks, normally 1–2 files | gpt-6-luna / medium | Clear inputs and visible expected output |
| Initial architecture, database/auth trust-boundary review, final integration review | gpt-6-astra / high | Reserve deeper reasoning for costly failure modes |

Use current tool-supported model IDs; availability is not guaranteed indefinitely. No price or token savings percentage is asserted. A smaller model can cost more if repeated debugging outweighs the initial saving.

For this build, dispatch one implementation agent at a time in a shared checkout. Read-only review can be delegated independently after the current patch settles. Parallel implementation is permitted only with explicit disjoint file ownership and separate checkouts; never let two agents edit schema, command contracts, package files or the same UI concurrently.

Keep prompts small: task card + required PRD/module sections + affected files + previous contract/evidence. Use fresh agent context, not the entire conversation. Do not ask every agent to repeat repository discovery or read the complete old PRD.

Each completed task receives a specification check followed by a code-quality check. Low-risk mechanical work can use a standard reviewer; database/auth/correction batches and final integration use the stronger reviewer. Do not start quality review before fixing a spec failure. Reuse the implementer's context for focused fixes rather than generating another full implementation.

Escalation: one repair attempt with concrete failing evidence; if the same cause persists, change something—supply missing context, split the task or use the stronger model. Do not launch an unbounded retry/reviewer loop. Report external blockers, complete independent tasks, and preserve accurate completion status.

## 3. Dependency order

T00 → T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10.

T01 includes the early real-client capability check so account eligibility is discovered before the full MCP adapter. T02 pure contracts can continue if external login is temporarily unavailable; T08/T09 cannot be marked complete without real-client evidence. T07 display work may be split into a small Luna task after service contracts are fixed. A first complete doubles workflow closes T05, then exception and broader-format work finishes it.

## T00 — establish baseline and isolated development

Model: Sol high. Requirements: R01,R14. Owns BUILD-STATUS.md baseline section and the new isolated checkout setup only.

- [ ] Inspect current Git status, branch, remote identity and deployed Vercel commit without printing secrets. Read applicable AGENTS.md. Preserve the known unrelated session changes.
- [ ] Map the deployment to its Supabase project, applied migrations, table/constraint/policy/function/trigger inventory, and Auth configuration. Record evidence level and any unavailable access.
- [ ] Create/reuse an isolated checkout from the verified application baseline; record path/base commit. Reconcile necessary uncommitted dependencies explicitly, without blanket-copying shared work.
- [ ] Create/use isolated development database and test identities. Read existing test scripts before executing. Record their database target safely.
- [ ] Run baseline build/lint and relevant existing tests. Record pre-existing failures separately from feature failures.

Read-only commands to adapt to the verified root:

```powershell
git --no-optional-locks status --short
git log -1 --format="%h %cs %s"
git branch --show-current
rg --files app lib components supabase scripts -g AGENTS.md -g '*test*' -g '*.sql'
```

Exit: one source-of-truth map, isolated writable checkout and database, known regression commands. Do not run blanket Supabase migration push. Production parity may remain an external blocker, but a local snapshot must be explicitly identified before pure development continues.

## T01 — freeze contracts and verify connector feasibility

Model: Sol high; one bounded Astra high architecture review. Requirements: R02,R11. Owns contract refinements in PRD/MODULES/ARCHITECTURE and BUILD-STATUS.md, not product expansion.

- [ ] Reconcile local source/schema against the seven module contracts, initial policies and three allowed graph patterns.
- [ ] Verify actual ChatGPT and Claude accounts can add a write-capable test MCP connection and complete the selected OAuth flow. Use a minimal non-production capability probe; record success or specific external restriction.
- [ ] Check Supabase OAuth support, discovery, consent/client identity and application revocation strategy against current official documentation.
- [ ] Review the short transactional runtime, server-only effects boundary, direct-write guards, existing owner trigger and historical result preservation.
- [ ] Record decisions and exact schema/runtime changes in the docs. Keep the published rules immutable and the runtime bounded.

Exit: stable manifest/tool/command interfaces; external blockers explicit. Reviewer must resolve contradictory status/role/withdrawal/score semantics before T03.

## T02 — definition schema, catalog, validator and test runner

Model: Sol medium. Requirements: R02,R03. Owns:

- `app-root/lib/tournament-builder/definition.ts`
- `app-root/lib/tournament-builder/catalog.ts`
- `app-root/lib/tournament-builder/validate.ts`
- `app-root/tests/tournament-builder/definition.test.ts`
- Minimal test configuration and package script, coordinated centrally.

- [ ] Add `test:tournament` for Vitest and a separate integration suite command. Verify a deliberately failing contract assertion fails before implementation.
- [ ] Encode the exact ARCHITECTURE field contract and partial-draft shape; unknown fields and authority injection fail.
- [ ] Encode seven descriptors with required questions and the three permitted paths. Validate versions, unique IDs, connections, qualifier counts and dates.
- [ ] Return field-specific missing/errors/warnings without mutating incomplete drafts.
- [ ] Load the supplied example as a positive fixture; implement all F03 negative fixtures.
- [ ] Run targeted tests and a type/build check; submit schema/catalog interface for review before consumers use it.

Example test expectation, using the public API defined by this task:

```ts
expect(validateDefinition(validExample).valid).toBe(true);
const invalid = structuredClone(validExample);
invalid.nodes.find(n => n.module === 'qualify@1')!.config = { count: 6 };
expect(validateDefinition(invalid).errors.map(e => e.code))
  .toContain('INVALID_ADVANCEMENT');
```

Public contract: `validateDefinition(input: unknown)` returns `{valid, errors, warnings, missing_fields}`; exported issue fields match ARCHITECTURE.md. No database or AI dependency in this function.

## T03 — additive storage, atomic repository and database guards

Model: Sol high; Astra high review of transaction/permission boundary. Requirements: R01,R03,R04,R10,R14. Owns:

- One reviewed new migration under `app-root/supabase/migrations/` using the next valid naming convention established in T00.
- `app-root/lib/tournament-builder/repository.ts`, `access.ts`.
- `app-root/tests/tournament-builder/repository.integration.test.ts`, `permissions.integration.test.ts`.
- Necessary additions to `app-root/types/database.ts` and existing status label helpers.

- [ ] Write integration cases F04/F09 against ordinary actors: conflicting membership, cross-event reference, direct-write bypass, same-operation replay and rollback on injected failure.
- [ ] Add definitions, stages, operations and minimal existing-table extensions. Preserve existing IDs and legacy defaults. Reuse the owner creation trigger once.
- [ ] Implement verified-actor access, snapshot reads and the narrowly callable commit function described in ARCHITECTURE sections 5–7.
- [ ] Serialize operation identity and tournament revisions; repeated same requests return the committed receipt after reauthorization. Different bodies fail.
- [ ] Enforce modular direct-write guards across combined RLS policies, functions, triggers and old elevated routes. Verify legacy behavior still works.
- [ ] Rehearse migration forward on a sanitized fixture dataset; compare counts and identity/owner/session contracts.
- [ ] Run integration suite, targeted type check/build and independent security review. No production application in this task.

Exact behavioral expectation: with one remaining slot, `Promise.allSettled([admit(teamX), admit(teamY)])` leaves one approved and one pending entry, not two approvals. Injected commit failure leaves prior tournament revision, matches, stages and operations unchanged.

## T04 — draft/publication, registration, lifecycle and score commands

Model: Sol high. Requirements: R03,R04,R06,R08,R10. Owns:

- `app-root/lib/tournament-builder/commands.ts`, `policies.ts`.
- `app-root/app/api/tournament-builder/drafts/route.ts`.
- `app-root/app/api/tournament-builder/[id]/route.ts` and `commands/route.ts`.
- `app-root/tests/tournament-builder/commands.integration.test.ts`, `scores.test.ts`.

- [ ] Implement strict command dispatch from ARCHITECTURE; reject actor/owner/permission fields supplied by callers.
- [ ] Implement partial drafts, current-revision preview/publication and immutable published definitions. Publication creates no automatic owner-player enrollment.
- [ ] Implement explicit player/partner consent, admission, cancel/close/reopen/lock and start using existing team/member/profile identities.
- [ ] Implement startMatch occupancy/rest gates; legal score submission, actual opposing confirmation, dispute and reasoned admin attestation.
- [ ] Compose accepted command effects through the atomic repository. State advances only on accepted facts; a provisional score cannot qualify anyone.
- [ ] Run F02/F04/F09; fix old route bypasses for modular events. Preserve legacy mutation routing where required.

Concrete scoring assertion:

```ts
expect(isLegalPlayedScore(11, 9, { target: 11, win_by: 2 })).toBe(true);
expect(isLegalPlayedScore(12, 8, { target: 11, win_by: 2 })).toBe(false);
expect(isLegalPlayedScore(12, 10, { target: 11, win_by: 2 })).toBe(true);
```

Define `isLegalPlayedScore` in policies.ts. Every route must derive actor identity from verified credentials; UI booleans are never authorization evidence.

## T05 — modules and first complete tournament

Model: Sol medium, high for integration. Requirements: R02,R05,R07,R08. Owns seven files under `app-root/lib/tournament-builder/modules/`, shared `types.ts`/`runtime.ts`, corresponding tests under `app-root/tests/tournament-builder/`, and command integration needed for progression.

- [ ] Implement each MODULES.md assignment using the existing algorithm as appropriate; preserve legacy behavior in original callers.
- [ ] Registration/entries produce approved roster and persisted direct-elimination seed draw; RR emits unique pairs and legal court waves.
- [ ] Standings includes zero-result entrants, supported ranking order and unresolved tie groups. Qualification uses completed accepted outcomes and current draws only.
- [ ] Adapt bracket seeding/bronze/courts. Verify 8-entry opening order 1–8,4–5,2–7,3–6 and protected 16-entry halves.
- [ ] Implement automatic accepted-result progression and placements, including empty-slot outcomes. Persist effects in the same accepted transaction.
- [ ] Complete F01 via command API and F05/F06, with connector calls mocked only for this internal step. Restart/retry must not duplicate fixtures or completion.

Exact invariant test for RR: normalize each pair by sorting its IDs; the set size is n×(n−1)/2, each entry occurs n−1 times, every wave has ≤courts pairs, and the flattened entry list of each wave has no duplicate. Test n=2,3,5,8,16 with courts=1,2,4,8.

Exit: the complete eight-team event runs from saved draft to champion without AI. This is a technical milestone, not full MVP completion.

## T06 — corrections, ties, withdrawals and result history

Model: Sol high; stronger review for dependency invalidation. Requirements: R06,R07,R09. Owns:

- `app-root/lib/tournament-builder/corrections.ts` and command/module policy extensions.
- `app-root/tests/tournament-builder/corrections.integration.test.ts`, `withdrawals.integration.test.ts`.

- [ ] Build the impact preview from persisted stage/fixture dependencies and bind it to event revision/hash.
- [ ] Implement ordinary correction for affected unstarted fixtures and explicit void-and-replay for started dependencies; never delete accepted history.
- [ ] Implement every PRD withdrawal timing case, including whole-stage completeness rather than only the withdrawn player's pending matches.
- [ ] Implement auditable tie draw, retirement, walkover/no-contest, owner reopen and cancellation with no fabricated champion.
- [ ] Run F06/F07/F08 and rerun the complete F01 flow with each independent exception scenario.
- [ ] Verify all operations are idempotent and new corrections invalidate stale previews/draws.

Exit: complete before/after history and exact standings/qualifier consequences are demonstrated. No unresolved policy choice is silently coded as array order or arbitrary winner.

## T07 — website integration and focused display tasks

Model: Sol medium for integration; Luna medium only for isolated presentation components. Requirements: R03,R04,R06,R09,R13. Owns:

- `app-root/app/(app)/tournaments/[id]/review/page.tsx`.
- `app-root/components/tournament/builder-review.tsx`, `builder-progress.tsx`, `builder-impact.tsx` as needed.
- Existing tournament create/admin/matches/leaderboard pages and join/score/removal components, only at modular dispatch boundaries.

- [ ] Wire web draft creation/review to the same schema and command API; display all defaults and warnings with revision-bound publication.
- [ ] Route modular Join/partner consent, scores and administration through commands while keeping existing familiar screens.
- [ ] Add waiting/blocked state explanations, tie action and correction/withdrawal impact review. Show cancellations distinctly.
- [ ] Use the existing design components; verify 360px layouts, keyboard focus, labels and error text.
- [ ] Run relevant browser tests plus a build. A standalone new demo UI is not completion.

Permitted Luna subtask: render graph/rules/issues supplied as typed props in builder-review.tsx and builder-progress.tsx; no API, auth, schema or command changes. Supply exact input examples and a screenshot target. Sol integrates the result and checks behavior.

## T08 — MCP adapter, consent and both clients

Model: Sol high; Astra high authentication review. Requirements: R10,R11. Owns:

- `app-root/lib/tournament-builder/mcp.ts` and grant/access integration.
- `app-root/app/api/mcp/route.ts` plus OAuth consent routes required by the verified provider setup.
- `app-root/tests/tournament-builder/mcp.integration.test.ts`.

- [ ] Register exactly the nine documented tools with strict input/output descriptions and schemas.
- [ ] Map tools to existing draft services; do not duplicate tournament logic or add runtime mutation tools.
- [ ] Verify OAuth token issuer/audience/client/grant checks, app consent, revocation and protected-resource discovery.
- [ ] Test revoked credentials before receipt replay and cross-owner draft isolation.
- [ ] Connect actual ChatGPT and Claude test accounts; create and update an incomplete draft, validate, preview and obtain its owner review link.
- [ ] Verify published draft writes fail and that no service-level credential appears in a client or log.

Exit: real-client evidence, not only unit/mock transport success. Document any account restriction plainly; it remains an open dependency for full completion.

## T09 — end-to-end validation and integrated review

Model: Sol medium/high for tests; Astra high final review. Requirements: R01–R13. Owns browser/integration fixtures, evidence and necessary fixes assigned back to responsible implementers.

- [ ] Run the complete acceptance matrix against isolated staging; use real identities and database policies for security/concurrency.
- [ ] Run F01 once per actual AI creation client and revoke both before operating the event.
- [ ] Verify corrections/withdrawals separately so expected base counts remain meaningful. Test all three compositions and limits.
- [ ] Run existing auth/tournament/native-session regressions after new routes and database guards are integrated.
- [ ] Run build/lint and targeted unit/integration/browser suites. Record actual commands and test counts without claiming unrun scenarios.
- [ ] Perform specification review, then integrated code/permission/data-integrity review. Resolve findings and rerun affected checks only.

Expected commands after T02/T09 install their scripts:

```powershell
npm run test:tournament
npm run test:tournament:integration
npm run test:tournament:e2e
npm run lint
npm run build
```

Test scripts must fail when required isolated environment variables are absent; never fall back to production. An existing baseline lint failure is recorded and distinguished from new failures, not silently treated as a clean run.

## T10 — release candidate, migration rehearsal and authorized deployment

Model: Sol high; stronger review only for unresolved release risk. Requirements: R01,R14. Owns release evidence and integration; no unrelated cleanup.

- [ ] Record final commit, migration list, schema/policy diff, acceptance results, remaining limitations and application rollback behavior.
- [ ] Rehearse exact named migration on sanitized staging data. Verify historical IDs, counts, role ownership, links and session contracts.
- [ ] Prepare the reviewed production migration/deployment package and final smoke-test steps. Ask for production authorization only after this concrete package exists, unless already explicitly given.
- [ ] When authorized, apply only that reviewed migration and deploy the corresponding application revision.
- [ ] Verify actual production URL and behavior with bounded test accounts; record production separately from staging.
- [ ] Mark implemented/released status accurately. If authorization or external client capability is pending, preserve the ready work and name the precise remaining step.

## 4. Agent dispatch and return contracts

Coordinator prompt packet contains: task ID, exact source root/base, owned files, relevant contracts, full acceptance cases, dependencies already completed and verification command. Explicitly state which other files may not be changed. The agent does not need the whole conversation or old PRD.

Every agent returns:

```text
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Task:
Files changed:
Behavior implemented:
Verification commands and actual outcomes:
Contract/schema changes:
Remaining concerns or external blockers:
```

Do not include secrets or private player data. DONE requires passing relevant checks and a bounded diff. The coordinator verifies claims from files and command evidence, integrates, then updates BUILD-STATUS.md. Commit only the task's intended files if commits are used; never stage unrelated changes or the entire shared repository.

## 5. Token discipline and stopping rules

- Main coordinator retains the task/evidence table, not repeated raw logs or full source dumps.
- Only the assigned specialist reads its full module details. Share small source excerpts and exact failing output.
- Batch related tests once; rerun when a new patch/failure warrants it. Avoid repeated full builds after unchanged documentation.
- Ask the stronger model about a concrete unresolved design, risky diff or final integration, not routine formatting.
- Do not start a fresh chat for each module; use internal subagents under the same coordinated task unless the user requests separate chats.
- After implementation begins, continue authorized dependent tasks without routine confirmation. Pause only for unresolved necessary user input/access, or the reviewed production authorization step.
- The current turn stops after verified documentation because the user reserved implementation model selection. This is an explicit user sequencing choice, not a skill-imposed approval gate.
