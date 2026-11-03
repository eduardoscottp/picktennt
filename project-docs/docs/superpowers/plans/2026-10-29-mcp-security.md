# MCP security hardening implementation plan

Goal: expose only authorized tournament operations and necessary tournament data, with no infrastructure, credentials, raw storage records, or self-modification capability.

Architecture: retain current OAuth and transactional database authorization. Add strict tool input validation and explicit public response projections at the MCP boundary. Fail closed on errors and suspicious credential/infrastructure output. Treat all player-supplied text as untrusted data. Public OAuth discovery and tool contracts remain available because clients require them.

1. Reproduce disclosure, nested argument injection, and transport/parser leaks using synthetic secrets and local MCP clients. Verify failures before implementation.
2. Validate advertised schemas at runtime; reject prototype keys, excessive nesting, unsupported tools/methods, batches, and invalid request IDs. Keep 64 KB request bounds.
3. Project each response to an explicit tournament-facing contract, mask errors, constrain review links to the configured public origin, and supply client security instructions. Verify legitimate organizer workflows remain usable.
4. Test current account/grant/role isolation, receipt replay, revoked access, OAuth code/refresh replay, direct storage restrictions, and concurrent commands using local PostgreSQL-compatible storage. Add missing adversarial coverage.
5. Run the full suite, typecheck, scoped lint, dependency audit, and production build. Write findings, remediation evidence, deployment status, and remaining limitations in app/docs/evidence/mcp-security-2026-10-29.md.

Execution: inline in this chat. Preserve all pre-existing dirty changes. No production deployment, migration, account mutation, load attack, or secret output is part of this local verification.
