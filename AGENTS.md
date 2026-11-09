<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Player privacy and tournament MCP

- Expose only a player’s first name, last name, username and DUPR ID to other users, plus the minimum information needed to manage a tournament in which the requester is an authorized administrator. Internal account identifiers may be used by the application for tournament operations.
- Never expose email, account registration time or method, device ownership, or activity and statistics outside the authorized tournament. Never allow searches by private fields. Enforce this at the data boundary as well as in the interface.
- MCP access and actions must be limited to the authorized tournament and the explicit needs of its administrators. Do not disclose or speculate about infrastructure providers, database technology, security mechanisms, secrets or configuration in MCP responses or assistant-facing instructions. Use generic errors.
- Verify these rules with tests and review database access permissions before claiming that player information is protected.
