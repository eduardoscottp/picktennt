# Composable tournament blocks

Approved by the user on 28 October 2026: build the proposed block model, prove four groups of four advancing group winners to semifinals and a final, and preserve existing tournaments.

Version 1 definitions retain their existing semantics. Version 2 uses the same event, registration, scoring and scheduling envelope, but a graph of registration, entries, round-robin blocks, individual match blocks and placements. Entry sources are locked roster seeds, ranked positions from completed round-robin blocks, or winners/losers of completed matches. Inputs explicitly name destination slots by array order. No executable expressions.

Round-robin blocks support 2–16 inputs; match blocks require two. Connections must be acyclic, refer to compatible outputs, and not place a team on both sides or consume the same output twice. Roots partition the locked roster. A block waits for all required accepted results; rank-dependent advancement waits for ties affecting that position. Independent blocks can progress independently. Courts and players cannot overlap in planned waves. Estimated slots include rest/transition allowance; duration is an estimate, not a guaranteed finish time.

The first fixture uses 16 fixed doubles teams, four groups of four, A1 versus B1 and C1 versus D1, then winners in the final: 27 matches. Optional bronze uses semifinal losers. Group runners-up can feed another round-robin or match block. Placements declare the championship final and optional bronze; entrants not distinguished by the structure share a placement rather than receive invented cross-group ranks.

MCP discovery exposes the versioned graph schema and output-source vocabulary. Existing draft, review, publish and administration commands execute through the same authorization and atomic storage boundary. The website shows block-specific standings, source labels, connections and estimated duration. Accepted downstream results cannot silently change participants after a correction; preview and explicit replay preserve history.

Local implementation and verification are authorized. This work does not deploy or mutate an existing published tournament.
