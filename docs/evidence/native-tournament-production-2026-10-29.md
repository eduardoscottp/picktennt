# Native tournament production release

- User authorized production deployment on 29 October 2026.
- Deployed source: `9381f23a2bcbe9f05ca08f55b958a5b06e719a60`, branch `codex/native-tournament-site`, PR https://github.com/eduardoscottp/picktennt/pull/11.
- Verified Vercel project `picktennt-bw9r`, ID `prj_huFwDShek0jT1QZGtJNfEduYQiN3`.
- Production deployment `dpl_D4jAHe8PxJyaQ29nynCmNdXBtUqv` reached READY; build duration 54 seconds. Staged without the custom domain, smoke-tested, then promoted.
- Final inspection of https://app.picktennt.com resolves to this deployment.
- Previous production deployment retained: `dpl_1486RDn8KGBZG9vRcoW9ejVoaFzD`, URL https://picktennt-bw9r-2dbafeokd-eduardoscotts-projects.vercel.app.

## Database

Verified production project `qmiljmxnnryhuaudpuff` already had tournament migrations 001–010 and `202610290001`. Applied only `202610290003_tournament_list_visibility` and `202610290004_tournament_dupr_selection` in one transaction, recording their exact SQL in migration history. Guards rejected a missing revision baseline or previously applied target migrations. Postconditions confirmed the anonymous read policy and DUPR command support. All table row counts in `public` and `tournament_builder_private` were unchanged.

No existing tournament was edited and no DUPR submission was performed. Application rollback does not undo database policy/function changes; database rollback needs a separately reviewed script, not a destructive reset.

## Live verification

Immediate post-release Vercel scans returned zero runtime error records and zero HTTP 5xx request records for this deployment in the preceding ten-minute window. This is a short release check, not ongoing monitoring.

Public requests after promotion: home `200`; tournaments `307` to `/login?redirect=%2Ftournaments`; unauthenticated MCP `401`; OAuth authorization-server metadata `200`. The same protected staging checks passed before promotion. These checks verify release routing and authentication boundaries, not signed-in organizer behavior. Authenticated tournament editing, cross-platform join acceptance and deliberate external DUPR submission remain user acceptance tests.
