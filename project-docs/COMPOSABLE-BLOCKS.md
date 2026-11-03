# Composable tournament blocks, version 2

Implemented and deployed on 28 October 2026. Version 1 definitions and existing published tournaments retain their original behavior. This extension uses the existing authenticated command boundary, database tables and MCP endpoint; no new migration is required. Deployment `dpl_AvaoBnrxSDK1cbA3EkataXPdTHSR` is live at `https://app.picktennt.com/api/mcp`. Authenticated creation through an actual Claude connection remains the user acceptance step.

## First complete example

[four-groups-definition.json](examples/four-groups-definition.json) describes 16 fixed doubles teams, four groups of four playing full round robins. Group A's winner plays Group B's winner; Group C's winner plays Group D's winner. The semifinal winners play the championship final.

There are 24 group games, two semifinals and one final: **27 matches**. A full 16-team round robin alone has 120 games. The preview estimates elapsed time from dependency-aware court waves, slot duration and contingency. Estimates are not guarantees. Slots include transition/rest allowance; the existing no-minimum-rest enforcement remains intact.

## Blocks and connections

Set `schema_version` to `"2.0"`. The event, registration, policies and scheduling envelope is the same as version 1. The graph contains exactly one `registration@1`, one `entries@1` referencing registration with `from`, and one `placements@2`.

| Block | Configuration | Outputs |
|---|---|---|
| `round_robin@2` | `id`, `inputs` with 2–16 sources | Accepted results, standings and ranks |
| `cross_play@1` | `id`, nonempty `side_a` and `side_b` with at most 16 total sources | All A-versus-B games, combined standings and ranks |
| `match@1` | `id`, `inputs` with exactly two sources | Winner and loser |
| `placements@2` | `id`, `final` naming the championship match, optional `bronze` | Champion and placement groups |

Sources are structured references:

```json
{ "kind": "seed", "seed": 1 }
{ "kind": "rank", "node_id": "A", "rank": 1 }
{ "kind": "winner", "node_id": "SF1" }
{ "kind": "loser", "node_id": "SF1" }
```

Input array order identifies destination slots: first is side A, second is side B. In a group, it establishes incoming entry order. Seeds reference the persisted server draw at roster lock, not invented player IDs.

A semifinal can receive A's first-place team and B's second-place team:

```json
{
  "id": "SF1",
  "module": "match@1",
  "inputs": [
    { "kind": "rank", "node_id": "A", "rank": 1 },
    { "kind": "rank", "node_id": "B", "rank": 2 }
  ]
}
```

Cross-play creates only games between its two sides. Four entries on each side create 16 games; entries on the same side do not play each other:

```json
{
  "id": "A_vs_B",
  "module": "cross_play@1",
  "side_a": [
    { "kind": "rank", "node_id": "A", "rank": 1 },
    { "kind": "rank", "node_id": "A", "rank": 2 }
  ],
  "side_b": [
    { "kind": "rank", "node_id": "B", "rank": 1 },
    { "kind": "rank", "node_id": "B", "rank": 2 }
  ]
}
```

Internal seeded pairings use ordinary match blocks. For a nine-entry group, four qualifier blocks can connect rank 9 to rank 1, rank 8 to rank 2, rank 7 to rank 3 and rank 6 to rank 4. The four `winner` outputs then feed the next round. Rank 5 does not advance unless the definition explicitly routes it.

Runners-up can enter another round-robin block; winners can enter another match; semifinal losers can enter bronze. Distinct rank ports remain distinct through downstream matches, supporting A1/B2 versus A2/B1. Reused output ports, cycles, missing references, incompatible source types and potentially duplicate participants are rejected.

## Readiness and outcomes

Each destination waits for its sources. A group rank is available after all group outcomes are accepted and ties affecting that rank are resolved by a recorded draw. Provisional/disputed scores do not advance teams. Independent groups progress independently. A completed source with no available requested rank supplies an empty slot for an audited walkover/no-contest.

Every playing block must finish, including consolation branches. Final placements distinguish only what the championship structure proves: without bronze, semifinal losers share third; teams whose relative order was never established share a placement. Group tables retain their local rankings. Additional consolation results do not invent an overall cross-group ordering.

Incomplete-group withdrawals nullify participation only in affected group standings. After group completion, history and the selected rank entrant are preserved; eligibility is handled through an audited empty-slot outcome rather than silently substituting another entrant. Corrections preview changed downstream inputs; an unchanged advancing team does not require a later match to replay. Started affected matches require explicit void-and-replay, preserving old results.

## MCP and website

`get_capabilities` and `list_modules` advertise graph blocks. Existing draft, validation, preview, publication and administrator commands execute version 2 definitions. Missing draft decisions remain missing fields. Permission scopes, revisions, idempotency and owner publication review continue to apply.

The website displays block cards and incoming conditions, separate group standings, tie controls, future-opponent source labels and duration estimates. Assembly is through MCP or the existing JSON draft editor; a drag-and-drop editor is not included.

Bounds: 2–16 singles or fixed doubles entries, exact fixed capacity for version 2, 1–8 courts, at most 64 nodes. Scoring and ranking policies are shared by the composition. Arbitrary formulas, custom code and per-block policy overrides are not supported.

## Verification

Graph tests cover the 27-game example, top-two cross-seeding, cross-play, explicit internal seeded qualifiers, later round-robin/consolation blocks, bronze, draws, absent ranks, provisional scores, corrections and withdrawals. A PGlite test creates 32 actual local Auth/profile records, enrolls 16 doubles entries, persists all 27 results through the SQL command RPC, verifies four standings tables and placements, and proves stale writes roll back without receipts.

From `app/`, run `npm test`, `npx tsc --noEmit` and scoped ESLint. Current build, deployment and render evidence is in [BUILD-STATUS.md](BUILD-STATUS.md). Deployment does not by itself establish actual Claude use.
