# MCP confirmation content regression

## Scope

Clients that consume MCP `content` but ignore `structuredContent` received the human confirmation question without the `preview_hash` required to apply the confirmed change.

## TDD evidence

- RED: `confirmation previews keep machine fields in content for clients without structured content support` failed while parsing the confirmation question as JSON (`Unexpected token 'A'`). Checkpoint: `b885d9e`.
- GREEN: confirmation responses retain the human question as the first content block and add the projected machine payload as a second JSON text block. Existing `structuredContent` remains unchanged.
- Focused MCP matrix: 40 tests passed, 0 failed.
- Focused coverage: `lib/tournament-builder/mcp.ts` reached 99.04% lines, 84.00% branches, and 91.67% functions.
- Lint: 0 errors (194 existing warnings).
- Production build: `next build --webpack` passed compilation, TypeScript, static generation, and build tracing.

## Baseline limitation

The repository-wide test command still contains an unrelated migration failure, `PRESERVE_TEAMS_SOURCE_MISMATCH`. The same focused failing case was reproduced on unmodified `origin/master` at `8174bd5`, so it is not a regression from this change.
