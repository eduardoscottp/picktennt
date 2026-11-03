# Draft required fields and team labels

User-requested refinement of the approved registration flow: show editable controls for missing setup facts, red required-field feedback and a clearly gated publication step. Rename visible seed placeholders to Team N without changing stored seed references.

1. Add failing component regression cases for the exact missing-field report, including absent booleans and scheduling; verify required/red/accessible controls and publication blocking.
2. Add a draft setup editor using existing Input/select styles. Cover event, registration and scheduling envelope fields; preserve unknown/unrelated draft facts. Date/time controls use the event timezone, including daylight-saving offsets. Empty values stay missing rather than becoming zero or false.
3. Bind live field feedback and validation-summary links to form inputs; preserve partial draft saves and the existing owner review/publication guard. Expose missing fixed policies through the existing policy editor where needed.
4. Change source presentation from Seed N to Team N, retaining backend seed keys and match routing. Verify graph labels and existing match views.
5. Run focused tests, full suite, TypeScript and scoped lint. Record local evidence and deployment limitations; preserve unrelated dirty source and production data.

All five steps are implemented. Regression tests reproduced the missing controls and Seed N labels before changes; 257 tests pass after implementation. TypeScript, scoped lint and the hydrated desktop/mobile browser journey pass. Evidence is in `app/docs/evidence/draft-required-fields-2026-10-29.md`. No deployment or production mutation was performed.
