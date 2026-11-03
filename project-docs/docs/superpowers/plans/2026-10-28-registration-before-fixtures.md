# Registration before fixtures Implementation Plan

> Execute inline using executing-plans; preserve the existing dirty application checkout and unrelated work.

**Goal:** Open registration with planned group slots and finalize actual groups before generating matches.

**Architecture:** Keep the existing command boundary and lockRoster transaction. Distinguish graph missing decisions from unsupported rules. Permit registration review of an unfinished knockout. Extend roster lock with optional nodes and explicit group assignments, preserving all published envelope policies and existing connections. Persist assigned seed slots in entries-stage output so runtime replay and corrections agree.

**Tech Stack:** TypeScript, Next.js, MCP SDK, Supabase SQL, node:test, PGlite.

1. Add failing cases in tests/tournament-builder/registration-planning.test.ts. Run `node --import tsx --test tests/tournament-builder/registration-planning.test.ts` from app; verify missing graph nodes and underfilled capacity fail before changes.
2. Update graph-validate.ts and validate.ts to report missing graph components as missing decisions. Add registration review mode, preserving strict generation validation. Update preview.ts to expose generation issues without claiming a complete fixture estimate for an unfinished graph.
3. Extend commands.ts lockRoster data with nodes and group_assignments. Complete only missing graph facts, retain envelope and existing nodes, enforce actual approved roster coverage and per-group minimum/capacity, persist seedAssignments, and create any newly completed stages in the same transaction.
4. Update graph runtime and correction replay to use persisted slot assignments; omit only definitively empty initial pool slots. Extend MCP schema/descriptions and capabilities with the registration/finalization contract.
5. Verify focused tests, add SQL persistence coverage, run npm test, TypeScript, scoped ESLint and production build. Update project evidence with exact outcomes and any remaining qualification/release limitations. Do not publish or mutate a user tournament as a verification shortcut.

## Execution result

All five tasks are implemented. Eight regression cases were added; the full suite has 252 passing tests. SQL persistence, MCP schema/confirmation, actual group assignments, pending graph completion, immutable published rules, stale writes, correction replay and finalized match labels are covered. Scoped lint and the isolated webpack production build with TypeScript pass. Temporary source copies were removed; existing dirty work and source history were preserved. No migration or deployment was performed. See `app/docs/evidence/registration-planning-2026-10-28.md` for exact behavior and remaining qualification limits.
