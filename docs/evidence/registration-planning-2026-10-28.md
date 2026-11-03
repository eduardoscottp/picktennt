# Registration before match generation: local verification

Status: implemented locally; not deployed. Existing production drafts, tournament data and grants were not changed. No migration is needed.

## Behavior

- Supported scheduling values can be saved when registration/entries/placement nodes or downstream graph references are missing. They are reported as missing decisions, not unsupported rules. Unknown modules/fields, duplicate inputs and incompatible supplied connections remain rejected.
- A version 2 plan with registration, entries and a complete group-slot capacity plan can open registration with zero actual entries and an unfinished knockout. Publication review discloses pending graph decisions and withholds a complete schedule estimate.
- Minimum roster size can be below capacity. Teams join using existing real-account registration and consent/admin-admission rules. No placeholder profiles or teams are created.
- After closing registration, `admin_lock_roster` accepts optional `group_assignments`, keyed by initial group node ID with arrays of actual approved entry UUIDs. Assignments are required for an underfilled roster, must cover the approved roster exactly once, and must respect each group's capacity and two-entry minimum. The native administration page also offers group selection and resets its review checkbox after assignment changes.
- Optional `nodes` completes pending knockout connections at lock. Existing published nodes and supplied facts are preserved. Finalized nodes and assigned seed slots are saved in the entries-stage output; the original published definition stays immutable. Shared scoring, consent, dates and scheduling policies cannot change through finalization.
- Generation requires a complete supported qualification graph. Automatic cross-group best-runner-up comparison remains unsupported. This change does not silently select manual qualification or a winners-only format.
- Only occupied initial group slots generate round-robin fixtures. Runtime replay, correction previews, published match labels and review pages use the same persisted finalization.

## Evidence

- Full suite: `npm test`, 252 passed, zero failed. The previous suite had 244 tests; eight registration/finalization cases were added.
- Focused final checks: 14 tests passed across registration-planning, SQL persistence and graph UI tests.
- TypeScript and scoped ESLint passed. Next.js webpack production build passed with bundled Node 24.19.0 in an isolated source copy. The initial sandbox builds hit Windows EPERM errors; the isolated build succeeded outside the sandbox. No production deployment occurred.
- PGlite journey: immutable published plan, zero initial players/matches, 20 local Auth/profile records enrolled as 10 doubles teams, groups of 3/3/2/2, eight group games plus semifinals and final, 11 accepted results and completed placements. Stale finalization rolled back without modifying the saved snapshot.
- MCP schema and command tests accept actual group assignments, require explicit structural confirmation, forward the exact reviewed roster revision and exercise the real command planner.
- Component rendering covers native group assignment and labels for a finalized graph that was incomplete when registration opened. Hydrated browser interaction and fresh external Claude acceptance are not claimed.

## Example lock data

```json
{
  "reviewed_roster_revision": 10,
  "group_assignments": {
    "A": ["actual-approved-entry-uuid-1", "actual-approved-entry-uuid-2"],
    "B": ["actual-approved-entry-uuid-3", "actual-approved-entry-uuid-4"]
  }
}
```

Use actual UUIDs and the current roster revision from `admin_get_tournament`, not these illustrative strings. If the published knockout is pending, also supply the full supported completed `nodes` array and show that exact proposal before obtaining administrator confirmation. The MCP envelope retains tournament ID, operation ID, expected event revision and `confirmed_structure_change: true`.
