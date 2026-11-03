# IDD-13 production release

- Released commit: `9088d524a8b56bcfa33c1e4fdf7880c083df96bf` on `codex/integrate-idd5-idd6-idd7`, pushed to the existing repository.
- Vercel project: `picktennt-bw9r`, deployment `dpl_J3ynZvwWsaxD6MYuGQKrM3W12733`, production target, READY. Remote Webpack build took 46 seconds.
- Built candidate: `https://picktennt-bw9r-ntjz83xxz-eduardoscotts-projects.vercel.app`; promoted to `https://app.picktennt.com` after candidate/API and database checks.
- Previous deployment: `dpl_FxaiSryXbT3rxZCf2RBoUP4Mtiyn`.
- Supabase project: `qmiljmxnnryhuaudpuff`. Applied `202611010002_doubles_revision_individual_slots.sql` and inserted its migration ledger entry in the same transaction. Verified partial-team and genuine-consent guards afterward.
- Prerequisite individual-slot schema/functions were installed, although version `202611010001` was absent from the existing ledger. Verified column, snapshot names, slot commands and authorization before applying the new guarded migration; did not replay or repair the older migration.
- Reported tournament `c8bc0a15-3b5f-51e3-a82e-0c15201b2ec3` stayed at revision 5: registration open, one joined player, no matches. No participant, consent, team, fixture or definition mutation was needed for deployment.
- Live smoke checks: login/signup HTTP 200; tournament page redirects unauthenticated users to login with its return path; tournament API HTTP 401 / UNAUTHENTICATED; MCP resource discovery HTTP 200; security headers present. Live domain resolves to the new deployment.
- Pre-release verification: full tournament suite 323 passing; 15 auth tests passing; additional focused UI regression passing; targeted ESLint and diff checks passing; local Webpack production build passing; ECC code/security review has no blocking findings.
- Limitation: no authenticated human Join/slot mutation was performed against the reported live event. Registration behavior was covered by local command, rendered UI, real-SQL and MCP regressions.
