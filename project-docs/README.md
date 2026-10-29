# Picktennt Tournament Builder — project context

**Local MCP security hardening (29 October 2026, not deployed):** strict tool validation, permission-filtered discovery, public response projections, safe errors, credential/infrastructure tripwires, persistent account throttling and bounded match pagination. Read the [security contract](../docs/MCP-SECURITY.md) and [adversarial verification report](../docs/evidence/mcp-security-2026-10-29.md) for test evidence, release boundaries and remaining checks.

**Local update awaiting deployment:** registration can open before players join, group slots can remain unfilled, and the admin reviews actual groups before generating games. Incomplete knockout decisions no longer block saving scheduling changes. See [verification and MCP usage](../docs/evidence/registration-planning-2026-10-28.md). Automatic cross-group runner-up ranking remains unsupported. The deployed status below describes the previous release.

Picktennt lets an organizer describe a pickleball tournament in Claude or ChatGPT. The assistant asks for missing rules, saves a modular draft, and the owner reviews and publishes it. Picktennt then runs registration, matches, score validation, standings, playoffs, and final placements through its existing website and Supabase database. The selected client for MVP testing is **Claude**; ChatGPT onboarding is a follow-up.

**Current state (28 October 2026):** The MVP is live at [app.picktennt.com](https://app.picktennt.com); the MCP endpoint is `https://app.picktennt.com/api/mcp`. Application source is in the repository root on `codex/tournament-builder-mvp`. The user's four-player tournament completed with ten validated games and places 1–4. The release passed 213 automated tests and 14 isolated browser cases. Fresh Claude consent for the new owner tools is still a user-side check; do not describe it as tested from Claude until confirmed. See [BUILD-STATUS.md](BUILD-STATUS.md) for evidence and current limits.

**Rules to preserve:** Every player needs a real Picktennt account. Administrator enrollment uses existing profiles and does not invent player consent or DUPR data. Scores can be saved and validated without a Start-game click or minimum-rest wait. Assistant permissions are explicit and separate for drafts, tournament administration, and owner actions. An owner action that changes tournament structure or access needs a current impact preview and explicit confirmation. Preserve the existing tournament UI, identities, and unrelated session work.

## Where to find details

**Composable blocks released (28 October):** Version 2 now supports multiple groups, cross-group play, explicit internal seeded matches, rank/winner/loser routing, semifinals, finals, bronze and consolation branches. Deployment `dpl_AvaoBnrxSDK1cbA3EkataXPdTHSR` is READY at the live MCP endpoint. Start with [COMPOSABLE-BLOCKS.md](COMPOSABLE-BLOCKS.md) and the [16-team, four-group example](examples/four-groups-definition.json). Fresh authenticated creation through Claude remains the user acceptance step.

| Document | Read it for |
|---|---|
| [COMPOSABLE-BLOCKS.md](COMPOSABLE-BLOCKS.md) | Version 2 blocks, explicit advancement sources, local verification and current bounds. |
| [PRD.md](PRD.md) | Product goal, supported formats, roles, requirements, and out-of-scope work. |
| [MODULES.md](MODULES.md) | Each tournament module's inputs, outputs, questions for the assistant, and behavior. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Database reuse, command flow, revision checks, storage, and API design. |
| [AUTH-INTEGRATION.md](AUTH-INTEGRATION.md) | OAuth, MCP connection, scopes, token handling, and revocation. |
| [ADMIN-ASSISTANT-REQUIREMENTS.md](ADMIN-ASSISTANT-REQUIREMENTS.md) | What a connected administrator or owner can do and when confirmation is required. |
| [REAL-ACCOUNT-ENROLLMENT.md](REAL-ACCOUNT-ENROLLMENT.md) | Player account policy, administrator admission, consent, and DUPR boundaries. |
| [MVP-reuse-plan.md](MVP-reuse-plan.md) | Existing Picktennt code and tables reused for the MVP. |
| [ACCEPTANCE-TESTS.md](ACCEPTANCE-TESTS.md) | Functional, security, regression, and final-placement test scenarios. |
| [TEST-THE-MVP.md](TEST-THE-MVP.md) | Steps to connect Claude and test a tournament on the live site. |
| [BUILD-STATUS.md](BUILD-STATUS.md) | Latest verified deployment, migrations, test evidence, and remaining external checks. |
| [ISSUE-BOARD.md](ISSUE-BOARD.md) | Delivered changes and follow-ups; [CSV](ISSUE-BOARD.csv) is the portable board export. |
| [RELEASE-PLAN.md](RELEASE-PLAN.md) | Source preservation, feature branch, deployment, and PR preparation. |

For a new chat, start with this README and [BUILD-STATUS.md](BUILD-STATUS.md), then open only the documents relevant to the task. Some older handoff notes in [START-HERE.md](START-HERE.md) describe earlier phases; use the current status and evidence above when they differ.
