# Tournament player identity policy

Current requirement, 28 October 2026: every new tournament player references an existing real Picktennt authentication/profile identity. A display name is not an account. Registration preserves that profile’s existing DUPR linkage; it does not fabricate or remotely verify a DUPR identity, and modular DUPR export is not included in this increment. Missing DUPR information remains a separate existing preflight/submission concern.

Players may join from their own signed-in accounts and accept the exact published definition; fixed doubles requires both people’s actual consent. Alternatively, a current authorized administrator or explicitly scoped assistant may enroll existing profiles, recording `admission_source: administrator`, the acting administrator and current definition. That action never sets personal-consent timestamps or claims acceptance on another person’s behalf.

## Native and assistant enrollment

During open registration, Admin resolves one exact existing Picktennt username for singles or two for fixed doubles. Review the actual returned players and entry name, then enroll the entry. The command and SQL recheck real profiles, cardinality, uniqueness, current memberships, deadline, capacity and revision. No account-free guest enrollment is permitted. Canceling an administrator-enrolled entry must also reject the corresponding player projections while leaving personal consent untouched.

The assistant follows the same account lookup and enrollment contract with fresh `tournaments:admin` consent. Old draft-only connections retain their original permissions. A broader owner grant does not manufacture a player identity or personal consent.

Roster labels distinguish **Administrator enrolled · Picktennt account** from personal acceptance. Existing historical guest rows retain their historical label; never delete or silently convert their identities or results.

## Owner administration and release boundary

Owner publication, cancellation, completed-result reopening and administrator add/remove require current ownership, explicit owner scope for connectors, a current preview and confirmation. Owner protection, audit/replay and immediate removal of delegated access remain required. Production database migrations 009/010 are applied with preserved row counts, existing grants, function security and completed user event revision 43; application deployment and live owner-tool/browser acceptance are pending. Evidence: app/docs/evidence/owner-release-2026-10-28.json.

Registered-profile routine administration was released on 28 October 2026 in `dpl_BzEPQxDKYwS4pANqkA9c7FfJqY9S`. The user confirmed fresh Claude administrator tools. Actual-client mutations, local synthetic HTTP MCP evidence and later owner-release evidence remain distinct in BUILD-STATUS.md. ChatGPT onboarding is a follow-up to the chosen Claude path.
