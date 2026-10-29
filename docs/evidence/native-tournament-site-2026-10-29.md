# Native tournament site integration

Application rollback checkpoint: `e185ea5b8b6083438419d23cad24e9a6609c6ce6` on `codex/tournament-builder-mvp`, verified against GitHub before editing. Implementation branch: `codex/native-tournament-site`.

## Behavior

- The existing tournament list uses database access rules instead of a public-only filter. The new policy includes public events, ownership, current administrators, pending/approved players and pending/active team membership. Unrelated accounts cannot list private events; anonymous access remains public-only.
- Published modular tournaments reuse the native page width, navbar/logo, brand colors, cards, status badge, buttons and four-tab navigation. Overview and Admin expose the stored join code through the existing ShareButton and canonical `/join/[code]` link. No join-route or self-registration consent rule changes.
- Before roster lock, Matches shows the planned graph with TBD assignments before the roster. It renders no saved-score controls or historical fixture wall. Actual registered players, team names and entry states remain visible under the existing authorized snapshot projection.
- Matches and Admin reuse the existing real-account enrollment, approvals, rejections, withdrawal and revision-review workflows. Team editing now identifies existing players by their display names. Registration lifecycle and owner access management remain in Admin.
- Completed events expose explicit DUPR match selection through a revision-aware, audited command. The SQL boundary independently restricts it to current website administrators and current validated played matches outside results review. Existing preflight/profile lookup/upload confirmation is reused. Modular uploads exclude voided/excluded/old fixtures, require the reviewed event revision, and exclude replaced roster members while retaining actual players who later withdrew. No upload occurs merely by selecting a match.

## Verification

- Automated suite: 312 tests pass, including SQL listing authorization, audited DUPR selection/replay/stale-write rejection, and roster identity preservation.
- TypeScript and scoped lint pass. Existing `any` warnings remain in legacy DUPR components/routes.
- Local Next.js webpack production build passes. Windows required an elevated local build to refresh generated `.next` output.
- `node --import tsx scripts/tournament-builder/verify-native-site.ts` passes eight hydrated browser views: Overview, Matches, Standings and Admin at 1440px and 390px. It verifies canonical sharing, real player names, admin field editing, player-role visibility, a close-registration command, zero generated fixtures and zero browser errors. This uses synthetic state and the real command planner, not production authentication or real account mutations.
- Screenshots: `native-tournament-{overview,matches,leaderboard,admin}-{1440,390}.png` in this directory.

## Release boundary

No production deployment, migration, account change or DUPR submission was performed. Before deploying this branch, apply the pending application migrations in order, including this change's `202610290003_tournament_list_visibility.sql` and `202610290004_tournament_dupr_selection.sql`. The SQL tests use an isolated local PostgreSQL-compatible database. Real authenticated acceptance and a deliberate live DUPR submission remain release checks.

Returning to the application checkpoint restores the previous source. Database migrations require their own reviewed rollback; reverting a PR alone does not undo a deployed schema/policy change or an external DUPR upload.
