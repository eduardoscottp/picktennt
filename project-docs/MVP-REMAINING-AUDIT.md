# MVP remaining acceptance audit

Audit date: 28 October 2026. Scope: source and saved evidence review only; no deployment, production writes or fresh external-client claim. The latest user amendments control over older contradictory text.

## Current completion target

The chosen client is **Claude**. The goal is ChatGPT **or** Claude; a second ChatGPT account journey is not a release blocker. Elapsed rest and a separate Start game action are no longer required. New entries must reference real Picktennt profiles; administrator admission must remain distinct from personal consent. Profile/DUPR links must be preserved, never fabricated. Latest full administrator parity includes owner actions when the connected account is actually the owner; delegated administrators must not gain owner rights.

The original core journey has substantial live evidence: actual Claude created draft `549b556b-3533-5b64-a89a-b4552294fa2b`, the user's event completed and was preserved at revision 43, and the user confirmed fresh Claude administrator-tool discovery. Those facts should not be relabeled unverified merely because ChatGPT has not been tested. Expanded owner administration is not yet complete in the audited source.

## Must fix before declaring the expanded MVP complete

| Priority | Gap and concrete evidence | Completion check |
|---|---|---|
| P1 | **Owner assistant parity is incomplete.** `app/lib/tournament-builder/mcp-admin.ts` lacks publication, whole-event cancellation and reopening completed results. `commands.ts` requires owner website approval, and SQL008 authorization denies these commands to connectors. This is a real implementation limit, not an external-client limitation. | Provide explicit owner-scoped tools using current ownership, reviewed revisions/impact and auditable confirmation. Keep delegated admins denied. Test revocation, receipt retries and role changes through SQL and HTTP MCP. |
| P1 | **Existing owner administrator management is absent from modular views/commands.** PRD People and authority includes existing admin management. The modular Admin view has no equivalent of legacy administrator-management controls, and commands have no administrator add/remove operations. The legacy write guards correctly prevent bypassing this through old direct writers. | Add minimal real-profile administrator add/remove commands and native/assistant controls. Protect the owner, require current owner authority, retain audit/CAS/receipts, and make removal effective before cached-receipt recovery. No new role or ownership-transfer system is needed. |
| P2 | **Canceling an administrator-enrolled entry leaves an approved player projection.** In `commands.ts` the `cancelEntry` branch rejects the tournament-player projection only when `member.consented_at` is truthy. Administrator members correctly have null personal-consent timestamps. Inline reproduction returned cancelled team/membership and no `tournament_players` patch. | Regression for singles and fixed doubles: cancel the real account's admin-enrolled entry, retain null consent, reject all corresponding tournament-player projections, release capacity and preserve history. |
| P2 | **Acceptance/status documentation still contradicts the selected target.** Old PRD/acceptance sections require both clients, enforced rest/Start, and draft-only assistants. Some status headings still describe actual Claude as pending despite later successful draft/discovery evidence. `registered-entry.tsx` and identity documentation say a DUPR ID is mandatory, whereas the agreed registration contract verifies real profiles and leaves DUPR preflight separate. | Reconcile the current acceptance checklist/status summary around Claude OR, no rest/Start, no guests, registered profiles, owner parity and actual evidence. Preserve historical sections as history. Describe DUPR linkage/preflight accurately without claiming remote identity verification or upload. |

## External/live verification still needed

1. **Actual Claude administrator mutation, after the final release.** Current evidence proves real Claude draft creation and new tool discovery, plus local native-consent → isolated HTTP MCP → SQL mutations. It does not yet prove an actual Claude-issued new administrator/owner mutation. Use an explicit reported action on an authorized test event; record the tool/operation/event/revision and verify the resulting native view. Do not invent a score or alter the completed user event merely to obtain evidence.
2. **Final deployment smoke for newly fixed owner flows.** Recheck the promoted URL, normal Overview/Matches/Standings/Admin routes, native current-owner controls, scoped Claude discovery, revoked/old-grant denial and final placement display. The previously deployed release is not evidence for code added afterward.
3. **Final integrated regression after the remaining edits.** The saved checkpoint reports192 passing tests and12 local browser cases. Run the updated suite, TypeScript, scoped lint, production build and focused owner/cancellation browser/SQL cases once the remaining changes settle. Existing real hosted concurrency and core tournament evidence remain valid at their recorded versions.

Actual ChatGPT onboarding is an optional follow-up unless the user changes the chosen-client requirement. A synthetic MCP client must not be reported as the user's Claude account, and local PGlite/browser identities must not be reported as production identities.

## Already evidenced; do not rebuild unnecessarily

- Strict complete/partial manifest discovery, exact enum errors and seven trusted modules; actual Claude discovery repair is recorded.
- Bounded round robin and2/4/8/16 elimination, qualification, bronze/shared placements, stable fixture IDs, accepted-result progression, correction/withdrawal history and recorded draws have algorithm/command/SQL coverage.
- Direct score entry, administrator Save & Validate, normal tournament routes and no elapsed-rest enforcement have separate local browser evidence and recorded deployments.
- Real-profile native and scoped connector enrollment retain original IDs, null unprovided personal consent and administrator source. SQL007/008 and connector-admin integration tests exercise current role/grant checks, revoked receipt recovery and unchanged old grants.
- The hosted synthetic four-profile event completed ten games and all four placements, with separate actual parallel HTTP receipt/revision/capacity/court checks. This is stronger than local-only evidence, while remaining distinct from actual Claude.
- Legacy behavior is protected by top-only route dispatch, command guards and storage/F01 regressions. No broad legacy rewrite or second rules engine is needed.

## Follow-ups, not blockers for the current chosen-client MVP

- Actual ChatGPT client/account onboarding and compatibility.
- Remote DUPR identity verification/export for modular events: the current code preserves profile linkage; new modular fixtures set `submit_to_dupr:false` and no new modular export workflow is advertised as complete. Existing applicable legacy DUPR paths remain separate.
- New formats, arbitrary fixture/rule editing after publication, payments, rotating partners, ownership transfer, a new scorekeeper role, notifications and native/watch tournament scoring remain outside the accepted MVP.
- Record the final fixes and remaining follow-ups as issue-board items after acceptance; the board must not substitute for finishing must-fix code.

## Sources checked

- `PRD.md`, `ACCEPTANCE-TESTS.md`, `ADMIN-ASSISTANT-REQUIREMENTS.md`, `REAL-ACCOUNT-ENROLLMENT.md`, `TEST-THE-MVP.md`, `BUILD-STATUS.md`.
- `app/lib/tournament-builder/{commands,mcp-admin,mcp,corrections,page-loader}.ts`, `app/app/api/mcp/route.ts`, SQL007/008 and modular Admin presentation.
- `app/docs/evidence/hosted-acceptance-2026-10-28.json`, `registered-account-admin-mcp-local-2026-10-28.json`, and the saved Claude draft repair evidence under `verification-local/`.
- Read-only inline planner reproduction of administrator-entry cancellation. No production mutation was performed during this audit.

This is a point-in-time remaining-work report. Follow-on fixes may supersede individual findings; record their tests and release evidence rather than silently treating the original audit as final acceptance.

## Follow-on fix checkpoint

The cancellation projection finding now has a RED→GREEN unit regression for singles/doubles and an actual SQL regression; administrator admissions keep null personal consent while cancellation rejects player projections. Owner administrator command/types and SQL 010 now have 2 unit and 5 SQL tests covering protected ownership, real profiles, audit/replay, privacy, succession and removal/revocation of connector access. SQL 009/010 were subsequently applied by the coordinator with preserved counts/grants/security and user event revision 43; see app/docs/evidence/owner-release-2026-10-28.json. Application deployment/native UI/external owner-action verification remain pending at this checkpoint. Original findings above describe the state when first audited, not an instruction to redo these fixes.
