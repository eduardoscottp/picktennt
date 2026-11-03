# Composable tournaments implementation plan

**Goal:** Execute a 16-team, four-group tournament using reusable blocks and explicit advancement routes.

**Architecture:** Add a version 2 graph definition beside the unchanged version 1 contract. Reuse scoring, round-robin generation, authenticated commands and atomic PostgreSQL effects. Keep graph validation, execution and preview in focused files.

**Tech stack:** TypeScript, Next.js, node:test, PGlite, existing Supabase command RPC.

1. [x] Add graph contract, validator, scheduler and deterministic runtime in `app/lib/tournament-builder/graph-*.ts`; first add `graph.test.ts` covering 27 matches, rankings, provisional scores, branch routing, ties, invalid connections and scheduling. Run the test red, implement, then run green.
2. [x] Integrate version dispatch in definition validation, JSON schema discovery and previews. Add contract tests proving the advertised schema accepts graph drafts and rejects invalid sources while version 1 tests stay green.
3. [x] Integrate graph results into `commands.ts`, corrections and withdrawals. Use stored graph stage output for accepted standings and source revisions. Test the actual create/publish/register/lock/score journey and replay boundaries through PGlite.
4. [x] Display graph preview, source labels and separate block standings in existing tournament views. Add a version 2 example JSON and targeted rendering/browser verification.
5. [x] Run all tournament-builder tests, TypeScript, scoped lint and production build. Review the diff and document verified evidence and any remaining release checks in BUILD-STATUS.md and README.md.

Verification commands from `app/`: `node --import tsx --test tests/tournament-builder/graph*.test.ts`, `npm test`, `npx tsc --noEmit`, scoped `npx eslint`, and `npm run build -- --webpack`. No production release is included.
