# Reviewable source release plan

Updated 28 October 2026 after final owner-control release. Application checkpoint `51adade` contains exactly 128 audited MVP files. The user explicitly approved pushing that checkpoint to `eduardoscottp/picktennt`, branch `codex/tournament-builder-mvp`. Push succeeded; remote and local full SHA `51adadeb181af6cdb3242bac3910308e27453aa0` match. No merge was performed. Remote PR creation remains dependent on GitHub CLI authentication and source integration review.

## Verified source base and preservation state

- Application checkout: `app/`, branch `codex/tournament-builder-mvp`, checkpoint `51adade`, based on session source `d3821bd29d9de851cea2e0491dd622aa72fc523b`.
- GitHub remote: `https://github.com/eduardoscottp/picktennt.git`. Live read-only branch lookup agrees with local refs: `master` is `137b5e08e5880973a51025dfabafcac0a32547a0`, `codex/session-games` is `d3821bd29d9de851cea2e0491dd622aa72fc523b`, and `main` is the separate iOS lineage at `cca7fa7189f5ab9bc4405a815e5d3ab1558e3cef`.
- The current feature branch's upstream still points to `origin/codex/session-games`. Do not use an ambiguous default push. A later authorized push must name the new feature/integration branch explicitly and must not force-push.
- The original backend checkout retains its modified `scripts/test-session-games.mjs` and untracked `supabase/migrations/013_session_games_v2.sql` and CLI temp directory. The alternate checkout is clean. This audit changed neither checkout.

## Commit scope and preservation

[RELEASE-ALLOWLIST.json](RELEASE-ALLOWLIST.json) records the exact inspected candidate paths, hashes, held paths, and legal-file Git-blob comparisons. It is a snapshot, not an automatically executable staging list. Regenerate it after ongoing work and review new paths before staging.

Candidate feature scope includes modular routes and command UI, OAuth/MCP, domain/runtime and repository code, dependencies and lockfile, reusable tests/harnesses, sanitized evidence, release documentation, ignore rules, and the ordered named migration source history. Keep historical migrations even where later migrations supersede a feature. Never blanket-push the database's pending migration directory.

Hold these out of the feature commit and preserve their files:

- Fourteen legal/support files, including the `next.config.ts` legal publication guard, exactly match `origin/master` blobs. They are already source-owned by the three legal/support commits on master. Do not duplicate them as new tournament work.
- The generated `AGENTS.md` change is framework metadata, not tournament implementation.
- `scripts/tournament-builder/add-two-specific-test-players.mjs` and `check-user-test.mjs` are one-off production fixture/inspection scripts. Retain locally; exclude them from the reusable application feature commit.
- `.env*`, `.vercel/`, `supabase/.temp/`, `test-results/`, `.next/`, `node_modules/`, coverage and local PEM artifacts must never be staged/uploaded. Ignore rules now explicitly cover the inspected paths. No sensitive path is currently tracked; the candidate-source secret-pattern scan found no matches. This is a scoped scan, not a guarantee about arbitrary future files.

### Why the legal guard must stay paired

The dirty `next.config.ts` imports `content/legal/ios/publication.json`. Committing that config change without its dependency would break the committed tree. The tournament feature does not require this config change: excluding both the guard change and its already-master-owned legal files keeps the minimal feature commit self-contained. Leave the tested working files unchanged; do not reset or delete them to manufacture a clean status.

Recommended final integration uses a separate clean checkout based on `origin/master`, preserving its legal/support history, then integrates the approved session-games lineage and the tournament feature commit. This avoids overwriting dirty source and produces the same combined legal + session + tournament source that has been deployed manually. Review the merge and run the final checks on that committed integration tree before a PR/deployment. `main` is not the web release base.

## Authorized checkpoint and integration workflow

1. Freeze a fresh status/file-hash inventory and evidence snapshot. Confirm original dirty work is still present and excluded. Reconcile release documentation with current account-only enrollment, direct scoring, no enforced rest, administrator scope and the exact named migration history.
2. Final release verification passed: 213 automated tests, TypeScript, scoped lint, 14 local browser cases, and the hosted production build. Keep baseline unrelated lint failures separately identified. Confirm current browser/hosted evidence covers the final source; do not relabel local simulated authentication as actual external-client acceptance.
3. Stage only the refreshed explicit feature paths, using Git literal pathspec handling for Next route brackets. Inspect `git diff --cached --name-status`, `git diff --cached --check`, sensitive-path absence and the staged diff before committing. Never `git add -A`, reset, stash away another person's work, or stage the whole original checkout.
4. Completed: local checkpoint `51adade`, subject `Add modular tournament MVP with scoped assistant administration`. Exactly 128 audited feature files were included. The source audit confirms working/index equality after standard CRLF normalization. Diff whitespace checking reported existing blank EOF lines and two trailing whitespace lines; no functional failure was reported by TypeScript, lint, tests or build.
5. Assemble and validate the clean master-based integration described above, preserving existing session and legal history. Document its exact final SHA and compare its source against the verified implementation snapshot.
6. Resolve GitHub authentication. `gh auth status` currently reports the saved token invalid; public remote reads work. Git push authentication is separately unverified. Do not extract/store credentials as a workaround. A remote draft PR is blocked until the authenticated account can create it.
7. After GitHub authentication is available for the authorized publication, push the explicit integration/feature branch without force and create a **draft** PR against the agreed web base with the exact reviewed body from [DRAFT-PR.md](DRAFT-PR.md). Attach the resulting PR to the task. No PR or issue was created during this audit.
8. Any future deployment must identify the actual committed source SHA. Production migrations 001–010 are already recorded according to current coordinator release evidence; source control is not a reason to reapply them. Do not reapply the already reviewed owner-control migrations as a source-control step.

## Acceptance and publication limits

The final portable issue board is local and ready; no external issue has been published. Current evidence includes local and hosted synthetic cases, actual user tournament completion, and user-confirmed Claude administrator-tool discovery. The accepted scope is ChatGPT OR Claude, with Claude selected. ChatGPT onboarding and an additional full-size hosted doubles run are optional follow-ups. External Claude mutation evidence must remain distinguished from tool discovery and local protocol evidence. See [ISSUE-BOARD.md](ISSUE-BOARD.md), [BUILD-STATUS.md](BUILD-STATUS.md), and [ACCEPTANCE-TESTS.md](ACCEPTANCE-TESTS.md).

The initial audit itself changed only ignore rules and local planning artifacts. Subsequent authorized coordinator work applied named migrations 009–010, deployed the final release and committed the audited MVP source. No merge or external issue/PR creation is claimed.

## Final released result

Deployment `dpl_B2XtEZgZcQwqKhsdVP7FxJ5MW4e4` is READY at [app.picktennt.com](https://app.picktennt.com). All 213 automated tests, TypeScript/scoped lint and 14 local browser cases pass. Hosted metadata returns 200 with draft/admin/owner scopes; anonymous MCP returns 401. Existing user event revision 43 and completed results remain unchanged. Fresh actual Claude owner-scope connection awaits the user account handoff; local owner HTTP MCP mutation and replay evidence remain distinct. Application checkpoint is `51adade`; the invalid GitHub CLI token still prevents claiming a remote draft PR.
