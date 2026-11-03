# Tournament editing and fair scheduling

Approved by the organizer on 2026-10-29 in this chat.

Save drafts freely. Open registration without creating fixtures. Before the first match starts, administrators can revise settings and approved team composition, remove entries, and redistribute teams at finalization. A revision requires an exact impact preview and a reason, preserves published definitions and old fixtures, and returns the tournament to closed registration. Review groups and explicitly generate again; no automatic redistribution or qualification changes.

Revisions create a new published definition and stage instances. Existing approved entries are explicitly reaffirmed by the administrator against that version; this is administrator admission, not invented participant consent. Player swaps are atomic and reference existing profiles. Pending invitations remain pending and require current-rule consent. Changing singles/doubles requires a complete valid resulting roster. Capacity cannot be reduced below retained entries.

Any match start or recorded outcome locks structural revision, including after result corrections. Name and venue text remain editable; court movement and result impact review use existing guarded commands. Historical definitions, rounds, matches, and operation snapshots remain available. Runtime uses only stages of the current definition.

Scheduling reuses circle-method opponents. Assign independent groups together across available courts, deterministically favoring waiting teams without player/court collisions or premature knockout games. Preserve scheduling under result replay. Preview actual group games and waiting metrics before generation, distinguish unresolved knockout slots, and expose unequal game counts. Score-based games cannot guarantee equal real minutes.

Verification: command permission/state/stale-preview tests; atomic SQL swaps, history, rollback and profile checks; generation and bracket completion after revision; fairness and conflict tests; UI preview/confirmation; typecheck, lint, full tests and production build. Local implementation only; production migration/deployment requires a separate authorized release.
