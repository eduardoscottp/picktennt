# Tournament revisions implementation plan

> Execute using subagent-driven-development with isolated file ownership and review after integration.

**Goal:** Edit saved tournaments safely before play and balance court waiting across groups.

**Architecture:** Pure revision preview and command effects feed the existing atomic command RPC. New published definitions and stage instances preserve history. Current-definition filtering prevents old stages from participating in replay. Separate deterministic scheduling keeps opponents and bracket dependencies unchanged.

**Tech Stack:** Next.js, TypeScript, PostgreSQL/Supabase, node:test, PGlite.

- [x] Add `revisions.ts`: `previewRevision(snapshot, actor, data)` validates full definition and optional batch `entries: [{entry_id, entry_name, player_ids, remove?}]`; returns exact revision-bound hash and affected fixtures. `planRevision` validates hash and creates immutable replacement definition/stages, deactivates old matches/rounds, and returns closed registration. Add `updateEventDetails` for name/venue only after play. Test duplicate players, capacity, incomplete bracket, stale hash and first-play lock.
- [x] Wire commands, web preview endpoint and MCP tools. Read tools show proposed effects; mutation requires preview hash. Filter snapshot stages/standings by current definition while retaining history in storage.
- [x] Add guarded migration for new commands and snapshot filtering. Deactivate changed memberships before upserting the new memberships so swaps satisfy uniqueness in one transaction. Test request/effect boundaries, unknown profile rollback, historical preservation and stale revision rollback in PGlite.
- [x] Add revision editor on administration page with existing field editors, batch team roster selection and account lookup, removal, reason, review then explicit confirm. Keep draft flow. Add actual schedule preview before roster lock and fairness table. Group assignments remain explicitly reviewed.
- [x] Keep circle pairings; schedule independent graph blocks together with deterministic wait priorities, player/court constraints and dependency barriers. Add tests for 6 teams/2 courts, odd counts, group balance, deterministic replay and finals.
- [x] Run `npm test`, `npx tsc --noEmit`, scoped ESLint, and production build. Review changes against approved scope, record results and migration release requirement. Preserve all pre-existing dirty work; do not stage or commit mixed changes.
