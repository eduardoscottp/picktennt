# Tournament view reuse

Approved direction: reuse Picktennt's existing tournament interface and structure, continuing the owner's October 28 request. This increment integrates the existing navigation and normal tournament routes with modular data and command handling.

## User experience

- `/tournaments/:id`: Overview with published rules, progress, entries and the existing consent-based registration flow.
- `/tournaments/:id/matches`: Match cards, stage names, scoring, administrator validation/correction and rest override; actionable errors stay beside the game.
- `/tournaments/:id/leaderboard`: Current standings and complete final placements, including shared placements and withheld results under review.
- `/tournaments/:id/admin`: Existing supported entry approval, lifecycle, withdrawal and owner event controls. Only current owner/admin may access this page. Scoring links to Matches.
- `/tournaments/:id/builder`: Draft review/edit/publish. Published bookmarks redirect to Overview.

Reuse the existing desktop TournamentTopNav and mobile TournamentBottomNav components. Do not add a second navigation design. Match-card mutations continue through the modular command API; legacy direct table writes remain excluded from modular events.

## Boundaries

No database migration, roster mutation, score change, fixture regeneration, or definition change is required. Legacy tournaments retain their current route rendering and actions. Feature-disabled modular pages remain unavailable. Authentication and snapshot authorization remain enforced before rendering private event data. Invalid UUIDs and inaccessible events retain appropriate not-found behavior.

Guest enrollment, wider assistant OAuth tools, new tournament formats, public anonymous viewing, and a complete legacy visual redesign are outside this increment. Existing authenticated access is preserved.

## Verification

1. Draft routes converge on the draft builder; published routes remain distinct without redirect loops.
2. Existing builder/review links reach the published Overview after publication.
3. Overview, Matches, Standings and Admin display their intended content; administrator controls remain role-gated.
4. Public/unlisted/private snapshot permissions and command permissions are unchanged; ordinary participants cannot open Admin.
5. Existing legacy events still render the legacy pages and join flow.
6. Scoring, correction, rest override, final placement and operation recovery tests pass.
7. Build and live browser checks confirm navigation on the current tournament without modifying its results.

## Released verification
Normal routes and shared navigation were deployed on 28 October 2026 (dpl_JC3Fh5gPuUTmDM3sLXoXvY3SA4tf). All 158 tests and eight local browser scenarios passed. Live authenticated checks confirmed Overview, Matches, Standings, Admin and the published builder redirect. A legacy overview still rendered. The ongoing test event remained active at revision36; no event mutation or migration was performed.
