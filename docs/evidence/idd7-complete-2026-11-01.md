# IDD-7 consolidated release

This delivery covers IDD-8, IDD-9, IDD-10, IDD-11, IDD-12, IDD-13 and IDD-24.

- Singles and Doubles expose stable individual positions. Joining a chosen position is atomic and uses the authenticated account; either Doubles position can be occupied first.
- Administrators choose a position, search only registered participants, and place or move them without creating registrations. Free position retains registration; Remove player removes only that participant. Confirmation cancellation makes no changes. Generated fixtures and subsequent play block these individual changes.
- MCP advertises participant self-service only after fresh `tournaments:play` consent. Existing grants do not gain permissions. Administrator discovery uses the registered roster and placement/removal tools; external account lookup and legacy administrator enrollment are no longer advertised. Owner account lookup for administrator access management is unchanged.
- Confirmation text is one human question. Preview references remain in MCP structured content for subsequent calls. Existing confirmation flags, revision checks, preview hashes, receipt recovery and authorization remain enforced.
- README links the included Linear guide and identifies Linear through MCP as the ticket system.

## Verification

- 331 tournament tests, including real PGlite SQL execution, adversarial identity checks, individual removal/release, same-position restoration, retry receipts, grant revocation and preservation of generated matches.
- 15 authentication tests; TypeScript, scoped ESLint and Webpack production compilation.
- Local Chrome through actual Next pages and real SQL: independent Singles/Doubles joins, 375/430 px layouts, desktop, named controls, keyboard placement, registered-only selector, canceled confirmation, release, relocation, removal and locked-state rendering. Native participation consent issues a player-only OAuth grant and cookie-free MCP discovery excludes administrator/owner tools.
- HTTP MCP confirmation regressions exercise both ChatGPT and Claude origins. They test the protocol responses, not either external assistant's final prose.

Browser evidence is produced with:

```powershell
$env:IDD7_ONLY = 'true'
node --import tsx tests/e2e/tournament-smoke.ts
```

The browser harness uses synthetic local authentication; it does not create production accounts, enroll real players, generate production fixtures or claim a real external ChatGPT/Claude account test. Screen-reader semantics are checked through accessible roles and labels; no manual assistive-device session is claimed.

## Release and history

The release uses the existing Picktennt repository and Vercel project. A new consolidated branch starts at the pre-IDD-7 native-site baseline `55b6ae3` and carries one commit containing the prior individual-slot work, IDD-13 correction, the already-deployed authentication integration needed to preserve the current application, and this completion. Existing published branches are preserved without force-pushing their history.

Only migration `202611020001_individual_roster_management.sql` is new. The production application wrapper verifies exact prerequisite function hashes and compares existing table data and function security metadata in the same transaction. It does not replay the legacy migration directory or alter existing consent/grants.
