# Picktennt Tournament Builder — start here

Project folder: `C:/Users/Eduardo/Documents/ChatGPT/Picktennt torunament Chatgpt`

## Objective and current status

Finish a working MVP in which an organizer creates a modular tournament through ChatGPT or Claude and Picktennt runs it independently after publication. Reuse the existing website, Supabase identities and tournament data model.

**Current phase: routine feature released; final owner-parity acceptance active.** The user authorized the existing production environment. Actual Claude draft creation and fresh administrator-tool discovery are confirmed, and the user tournament completed at revision 43. Hosted synthetic OAuth/MCP, concurrency and all-placement evidence are already recorded. The chosen-client target is Claude OR; ChatGPT onboarding is a follow-up. Database migrations 009/010 are applied, but their owner tools/native application release and live checks are pending. Read [BUILD-STATUS.md](BUILD-STATUS.md) for exact current counts, deployment and evidence; do not restart completed baseline work. [MVP-REMAINING-AUDIT.md](MVP-REMAINING-AUDIT.md) records the audit and subsequent fixes; [TEST-THE-MVP.md](TEST-THE-MVP.md) supplies user instructions.

## Read in this order

1. [PRD.md](PRD.md) — main product specification and numbered requirements.
2. [MVP-reuse-plan.md](MVP-reuse-plan.md) — inspected existing code, tables and reuse decisions.
3. [MODULES.md](MODULES.md) — module behavior, interfaces, assistant questions and implementer responsibilities.
4. [ARCHITECTURE.md](ARCHITECTURE.md) — storage, commands, authentication and migration boundaries.
5. [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — dependency-ordered tasks, owned files, models and review process.
6. [ACCEPTANCE-TESTS.md](ACCEPTANCE-TESTS.md) — exact functional and regression scenarios.
7. [examples/tournament-definition.json](examples/tournament-definition.json) — complete sample manifest for the eight-team workflow.
8. [BUILD-STATUS.md](BUILD-STATUS.md) — task evidence and outstanding access; update throughout execution.

PRD.md is authoritative for scope and product behavior. MODULES.md and ARCHITECTURE.md define its implementation contracts. The reuse plan is source evidence, not permission to preserve a defect. If documents conflict, resolve the discrepancy in the specification before implementing conflicting behavior.

## Existing application and preservation rules

The inspected application is `C:/Users/Eduardo/picktennt-backend`. Another copy exists at `C:/Users/Eduardo/coding/picktennt`. The isolated implementation is app/, based on d3821bd with the missing legal/support additions preserved from master. Current release and database evidence are in BUILD-STATUS.md.

As inspected on 28 October 2026, the first checkout was on `codex/session-games`, HEAD `d3821bd`, with existing session-test changes and an untracked session migration. Recheck before writing. Preserve those changes and all Android/Wear session contracts. Do not switch, reset, clean, stage or overwrite unrelated shared work.

This project folder holds the specification. Build in an isolated checkout of the verified existing application; do not scaffold a replacement website here. Record its absolute path and base revision in BUILD-STATUS.md. Read that checkout's AGENTS.md and relevant installed Next.js documentation before implementation.

## Continuing implementation and verification

Continue the current remaining-work audit and acceptance steps; T00 and the implemented core are historical completed work, not instructions to restart the build. Dispatch narrow tasks with fresh context and return evidence after each task. The user authorized the named migrations and deployment on the existing production environment; do not create paid staging. Continue hosted verification and the actual Claude account test.

Copyable continuation prompt:

> Build the Picktennt Tournament Builder MVP from this folder's PRD.md, MODULES.md, ARCHITECTURE.md, IMPLEMENTATION-PLAN.md and ACCEPTANCE-TESTS.md. Start from current BUILD-STATUS.md and MVP-REMAINING-AUDIT.md; preserve completed implementation and evidence. Reuse its Supabase accounts, tournament/team/match tables and UI. Preserve unrelated local work and native session contracts. Use the agreed model allocation, provide agents only their task context, and record actual verification in BUILD-STATUS.md. Continue through implementation and staging tests without routine permission questions. Production work is authorized; use BUILD-STATUS.md to distinguish database-applied migrations from application releases still pending. Do not mark the MVP complete until the selected actual AI client and the AI-disconnected tournament flow pass; report the other client as unverified until separately tested.

## Recommended model allocation

- Coordinator and most implementation: `gpt-6.1-sol`, medium; high for multi-file backend integration.
- Small UI/fixture tasks after contracts are fixed: `gpt-6-luna`, medium.
- Architecture, authorization/transaction review and final integrated review: `gpt-6-astra`, high, with narrowly bounded inputs.

These are task-fit recommendations, not a measured cost estimate. Model availability may change; check the tool's current supported models before dispatch. Selecting a coordinator does not automatically authorize unbounded expensive agent use. Use the fixed tasks and escalation policy in the implementation plan.
