# MCP Tournament Native Site Experience

## Goal

Make tournaments created and managed through the Claude/ChatGPT MCP feel and work like native Picktennt tournaments on the website. Organizers must be able to continue administering them directly on the site, with the same tournament state and validation rules used by MCP commands.

## Product decisions

- Preserve the current Picktennt visual system: PICKTENNT logo, turquoise brand palette, existing typography, navbar, card/button/badge styles, page spacing, and responsive behavior.
- Use the existing four tournament tabs: Overview, Matches, Standings, and Admin. Show Admin only to the owner or a current tournament administrator.
- Keep modular tournament storage and lifecycle. Integrate its website presentation with the existing Picktennt tournament shell instead of creating a third visual experience or replacing the legacy tournament engine.
- Website changes to modular tournaments must use the same revision-aware command/RPC layer as MCP. They must recheck current identity, permissions, state, and revision and preserve the existing audit and impact-review requirements.
- A public tournament is listed for any signed-in user. A private tournament is listed to its owner, current administrators, and users with an existing pending or approved player/entry relationship. The list must include eligible records from either tournament engine.
- Reuse the existing `tournaments.join_code`, `/join/[code]` route, and share-link behavior. Join codes are routing/invitation mechanisms and must not bypass account, consent, partner, or approval rules for self-registration.
- During registration, Matches displays the published planned structure and unresolved slots as TBD. Actual teams and players are shown from real registrations in the entry/roster area. Do not create placeholder players or fixtures.
- Fixtures are generated only after registration closes and an administrator reviews the actual roster and group assignments and locks the roster.
- In Admin, an administrator may directly enroll a player by selecting an existing Picktennt account, bypassing the player's self-service request and the normal approval step. Do not create guest identities or accounts. Keep the real profile and DUPR identity. Record this as administrator enrollment; it must not be represented as player-provided consent.
- Preserve revision safeguards for structural edits, especially after matches start, and preserve existing score, tie, correction, cancellation, and DUPR submission gates.

## Experience and data flow

### Tournament list

The signed-in `/tournaments` page combines public tournaments with tournaments related to the current account through ownership, current administrator membership, or a player/entry relationship. Search continues to filter tournament names. Existing list cards, status badges, sorting, and navigation style remain consistent with the site.

### Overview and shared join

An MCP-created tournament opens in the same branded tournament layout as other Picktennt tournaments. Authorized viewers can see the join code and share the canonical `/join/[code]` link using the existing share interaction. Private codes and event details are exposed only to users authorized to view the tournament. The join route resolves the code and navigates into the modular registration flow without inserting a player or entry itself.

Self-registration continues to require an authenticated Picktennt account and explicit consent to published rules. Fixed doubles continues to require an existing partner account and that partner's own acceptance. Approval-mode entries remain pending until an administrator acts. Open-mode entries follow the published mode and still require the submitting player to accept the rules.

### Matches and Standings

Before roster lock, Matches shows a preview of the published graph/plan with unresolved participant slots marked TBD. The approved and pending registration list shows real entry/team names and real account names/statuses as authorized. This is not a generated schedule and exposes no score-entry controls.

After roster lock, Matches shows actual generated fixtures and uses existing match readiness, score validation, tie, and correction controls. Standings explains that rankings are unavailable until match results create them; once present it displays the current authorized ranking projection. Final placements remain governed by completed results and the existing review rules.

### Admin

The existing modular command set is surfaced through the Picktennt-styled Admin tab. It supports published-field edits through the existing revision review, registration open/close/reopen, entry approval/rejection/withdrawal, direct enrollment of existing accounts, team/player management, roster review/group assignment/lock, administrator management, and owner-only tournament actions. DUPR submission remains available only under its existing completion and profile validation rules.

Direct enrollment searches only for exact existing Picktennt accounts within current tournament administrator authority. It records administrator admission, preserves linked profile/DUPR data, and never fabricates player consent. Any structural change remains subject to current revision and impact review, and changes after play begins follow the current locked-structure constraints.

## Authorization and privacy

- Use the current signed-in user and current server-side tournament role; do not trust stale browser or MCP role claims.
- Apply row-level access and backend command authorization on every read or write.
- Public list visibility must not expose private tournaments. For private tournaments, include pending participants only in their own list visibility and keep participant details subject to existing roster/privacy rules.
- The public join code resolves to the tournament's authorized registration page; it does not grant tournament administration or read access to private roster data.
- Website actions must not bypass the MCP command layer, account policy, revision checks, consent records, or audit records.

## Verification criteria

- A public modular tournament appears in the signed-in tournament list for an unrelated account; a private one does not.
- Its owner, current admin, pending player, and approved player each see a private tournament in the list; unrelated accounts do not.
- The modular Overview exposes the existing join code and share link, and `/join/[code]` resolves to the same tournament registration page without auto-enrolling or skipping required consent/approval.
- A direct admin enrollment accepts only a real existing Picktennt account, preserves its account/DUPR association, and records administrator enrollment without a player-consent claim.
- During registration the four-tab UI uses the existing brand/components; Matches shows the published plan and TBD slots, and actual registered team/player names and states are visible under the authorized roster projection.
- Before roster lock there are no generated fixtures or score-entry controls. After review and lock, the actual fixtures appear and existing match/standings behavior remains intact.
- Website mutations reject stale revisions, unauthorized actors, unsupported edits, and attempts to change locked structure, and they preserve existing owner-action and DUPR gates.

## Scope boundaries

- No redesign of the legacy tournament engine or the Picktennt brand system.
- No change to the MCP's tournament format vocabulary or unsupported tournament rules.
- No guest players, account creation on behalf of a player, fabricated consent, or fabricated DUPR information.
- No automatic fixture generation while registration is open.
- No production migration or deployment is included in this design document; deployment must follow the project's release gates after implementation review.
