# Administrator assistants — current requirements

Updated 28 October 2026. The user chose **Claude**; the product target is ChatGPT **or** Claude. Actual ChatGPT onboarding is a follow-up rather than a second-client MVP gate. See BUILD-STATUS.md for versioned evidence.

## Authority and parity

The connected assistant must perform the tournament actions available to its actual signed-in role: register existing profiles, manage registration and fixtures, validate/edit results, handle disputes, qualification, withdrawals and completion. Published rules stay immutable; arbitrary new formats or ownership transfer are not introduced.

- Draft actions use their existing permission.
- Routine administrator actions require fresh `tournaments:admin` consent, mapped to `admin:manage`, plus current administration of the target event.
- Owner actions require fresh `tournaments:owner` consent, mapped to `owner:manage`, and actual current ownership. They include publication, whole-event cancellation, reopening completed results and adding/removing administrators. Delegated administrators cannot use these powers.
- Owner actions require a current concrete preview, current event revision, explicit confirmation and the reviewed action hash. Explain affected data, access or fixtures before asking whether to proceed. Corrections and withdrawals retain their own downstream impact preview and replay requirements.
- Current role, grant and account binding are rechecked before every command and receipt replay. Old grants never gain permissions automatically.

Reuse the existing command engine, audit history, idempotency and the normal Overview/Matches/Standings/Admin views. Do not reconnect legacy direct table writers to modular events. Protect the owner on every administrator-removal path; preserve existing succession order without adding ownership transfer.

## Players and scoring

Every newly enrolled player must reference a real existing Picktennt profile. Preserve that account’s existing DUPR linkage; do not create substitute accounts, invent DUPR IDs, verify remote DUPR identity implicitly or claim modular export. Participant/partner consent and administrator enrollment are separate admission paths. Administrator registration records the real acting administrator and definition, with personal-consent fields left null unless the people actually consent.

For resolved eligible fixtures in an active tournament, participants enter a final score directly and administrators use **Save & Validate**. No separate Start game action or elapsed-rest wait is required. Do not synthesize a physical start timestamp. Explicit start commands remain compatible and retain occupied-court/player checks. Feeders, eligible participants, legal scores and opposing-entry confirmation remain enforced.

Ordinary website played-score validation may record its default audit reason. Disputes, exceptional outcomes and owner actions require explicit reasons. Show actionable errors beside the match, distinguish provisional from accepted results, and identify round robin, semifinal, final and bronze clearly. All final placements remain required.

## Current delivery and verification boundary

Routine registered-profile administration is released in deployment `dpl_BzEPQxDKYwS4pANqkA9c7FfJqY9S`. Actual Claude draft creation and fresh administrator-tool discovery were confirmed; discovery alone does not prove an actual Claude administrator mutation. Local isolated HTTP MCP→command→SQL mutation and browser evidence are recorded separately.

Production database migrations 009/010 are applied with preserved row counts, existing grants, function security and completed user event revision 43; application deployment and live owner-tool/browser acceptance are pending. Evidence: app/docs/evidence/owner-release-2026-10-28.json. Do not equate database application with deployed owner tools or completed external-client acceptance.

## Superseded history

Earlier iterations required elapsed rest and Start game, exposed draft-only assistant tools, briefly supported name-only guests, and restricted owner actions to the website. The latest user amendments supersede those restrictions as the product target. Historical evidence remains in BUILD-STATUS.md; historical guest records remain readable and are never converted into accounts or personal consent. No new guest enrollment is allowed.
