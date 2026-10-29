# Draft setup form: local verification

Implemented locally on 29 October 2026. No deployment, migration or production tournament edit was performed.

The draft review page now provides event, registration and scheduling controls above policy review, including expected finish, registration closing time, partner consent, organizer participation, match slot, planned rest and contingency. Missing values have red borders, inline messages, required markers and accessible error associations. Summary links jump to the corresponding field. Zero minutes and explicit No selections are valid answers; blank fields remain missing decisions.

Date/time pickers interpret wall-clock values in the configured event timezone, independently of the browser timezone. Tests cover summer/winter offsets, skipped daylight-saving times, impossible dates, repeated-hour offset preservation and changing the event timezone. For a new time in a repeated hour, the first occurrence is selected.

Users can still save partial drafts. The existing owner approval step stays disabled while the saved definition is invalid or local edits are unsaved; guidance explains completing the red fields, saving and then reviewing the updated rules. Visible source labels are now Team 1, Team 2, etc.; stored seed references and graph connections retain their existing meaning.

Verification: 257 automated tests passed; TypeScript and scoped ESLint passed. The hydrated Chrome fixture used the actual TournamentBuilder component, generated project Tailwind CSS, browser session storage and a synthetic local HTTP adapter executing the real command planner. It completed the missing fields, saved the draft, refreshed review, acknowledged rules/warnings and opened registration with zero enrolled players. No page errors or horizontal overflow occurred at 1440px or 390px. This does not establish production authentication, Supabase persistence or live Claude acceptance.

- [Browser result](draft-required-fields-browser-2026-10-29.json)
- [Missing fields on mobile](draft-required-fields-mobile-2026-10-29.png)
- [Completed form and review](draft-required-fields-complete-2026-10-29.png)

Run from app/: `npm test`, `npx tsc --noEmit`, scoped ESLint and `node --import tsx scripts/tournament-builder/verify-draft-setup.ts`. The browser fixture needs localhost access; sandbox network restrictions may require execution outside the sandbox. No new full Next.js production build is claimed for this UI refinement.
