# DUPR Implementation Spec

Date: 2026-05-09
Jira: KAN-13
Parent: KAN-10

## Goal

Integrate Picktennt with DUPR in a sandbox-first way so Picktennt can:

1. Link Picktennt users to DUPR player IDs.
2. Read current DUPR ratings when permitted.
3. Export validated tournament match results to DUPR after a tournament is completed.

Production match upload must remain disabled until DUPR sandbox/UAT access is confirmed and KAN-16 passes QA/go-no-go.

## Current state

Picktennt already stores `profiles.dupr_id` and `profiles.dupr_rating`, has tournament/team/match tables, and records validated scores in `matches`.

The current stub at `lib/dupr/client.ts` should be replaced before real use. It assumes a bearer `DUPR_API_KEY` and guessed endpoints. The discovered UAT Partner API uses partner client credentials to obtain a short-lived bearer token, then calls documented user and match endpoints.

## Required external inputs

Blocked until ED/DUPR provides KAN-12 inputs:

- DUPR Partner Client Key.
- DUPR Partner Client Secret.
- Confirmed sandbox/UAT base URL and production base URL.
- Confirmation that Picktennt is authorized for user search/batch/detail, rating access, and match create/batch/update.
- DUPR club/partner/event identifiers, if DUPR requires them in match payloads.
- Guidance on whether user consent is required for lookup/rating reads.

## Environment variables

Server-only variables:

- `DUPR_API_BASE_URL`: sandbox first, expected UAT URL until production go/no-go.
- `DUPR_CLIENT_KEY`: partner client key.
- `DUPR_CLIENT_SECRET`: partner client secret.
- `DUPR_API_VERSION`: default `v1.0`.
- `DUPR_EXPORT_ENABLED`: default `false`; must stay false outside sandbox until KAN-16.
- `DUPR_MATCH_SOURCE`: stable source label, e.g. `Picktennt`.
- `DUPR_CLUB_ID`: optional if DUPR requires it.

Never expose these values to the browser.

## Architecture

### `lib/dupr/client.ts`

Replace the stub with a server-only DUPR partner client:

- `getPartnerToken()` obtains `POST /auth/{version}/token` using `x-authorization: base64(ClientKey:ClientSecret)` and caches the returned JWT until shortly before expiry.
- `searchUsers(request)` calls `POST /user/{version}/search`.
- `batchUsers(request)` calls `POST /user/{version}/batch` when useful for rating refresh.
- `getUser(id)` / `getUserDetails(id)` wrap documented user detail endpoints.
- `createMatch(payload)` and `batchMatches(payload)` wrap `POST /match/{version}/create` and `POST /match/{version}/batch`.
- All calls return typed success/error results. Do not throw raw provider responses into UI code.

### Player linking and rating sync

Use `profiles.dupr_id` as the canonical link.

Recommended first implementation:

1. Allow a user/admin to save a DUPR ID directly on the profile.
2. Validate the DUPR ID with the user detail endpoint when credentials are present.
3. Store the latest rating in `profiles.dupr_rating` after successful validation or explicit rating refresh.
4. If DUPR permits search by name/email, add admin-assisted search later with ambiguity handling; never auto-link ambiguous search results.

### Match export

Export only when all are true:

- Tournament status is `completed`.
- Match status is `validated`.
- Both sides have complete DUPR IDs for all required players.
- Scores are present.
- `DUPR_EXPORT_ENABLED=true`.
- Match has not already been successfully exported.

Use deterministic identifiers to avoid duplicates:

- Match identifier: `picktennt:match:<match_id>`.
- Batch identifier, if needed: `picktennt:tournament:<tournament_id>`.

For singles/doubles, derive players from `team_members`. For mixed, derive players from `player_a1_id`, `player_a2_id`, `player_b1_id`, and `player_b2_id`.

Payload mapping:

- `matchDate`: prefer `scheduled_at` date; otherwise use validation/update date.
- `format`: `SINGLES` for singles tournaments, `DOUBLES` for doubles and mixed tournaments.
- `event`: tournament name or confirmed DUPR event identifier if provided.
- `identifier`: deterministic Picktennt identifier.
- `teamA` / `teamB`: DUPR player IDs plus `score_a` / `score_b`.
- Optional: `clubId`, `location`, `bracket`, `matchType`, `matchSource`, `extras` when confirmed by DUPR.

## Database changes

Add an export tracking table rather than overloading `matches`:

```sql
CREATE TABLE dupr_match_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  dupr_identifier TEXT NOT NULL UNIQUE,
  dupr_match_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','exported','failed','skipped')) DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_request JSONB,
  last_response JSONB,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Rationale: this keeps retries/idempotency auditable and avoids duplicate DUPR submissions.

## Server workflows

### Rating sync

- Trigger manually from profile/admin UI in the first version.
- Validate credentials and DUPR ID server-side.
- Update `profiles.dupr_rating` only after a successful DUPR response.
- Surface ambiguous/not-found/credential errors as actionable UI messages.

### Tournament export

- Add a server action or route that only tournament admins/system admins can call.
- Preflight all completed tournament matches and produce a clear readiness report:
  - exportable matches;
  - skipped matches and reasons;
  - missing DUPR IDs;
  - already-exported matches.
- Submit exportable matches using batch endpoint if available and reliable; otherwise submit one-by-one while preserving idempotency.
- Record every attempt in `dupr_match_exports`.
- Do not retry indefinitely. Retry only failed exports from the admin action after showing the stored error.

## Error handling and safety

- If credentials are missing, DUPR functions must return a disabled/configuration error rather than silently succeeding.
- If sandbox is unavailable, keep KAN-14 and KAN-15 blocked and do not implement production upload.
- Redact secrets from logs and Jira comments.
- Never submit a match twice for the same Picktennt `match_id`.
- Preserve partial results: one failed match should not hide successful exports.
- Keep provider response bodies out of public UI unless sanitized.

## Testing plan

Unit tests or focused test modules should cover:

- Partner token header construction and token-cache expiry behavior.
- Missing credentials and disabled-export behavior.
- DUPR payload mapping for singles, doubles, and mixed matches.
- Idempotent export behavior when a `dupr_match_exports` row already exists.
- Failed provider responses updating `attempt_count`, `status`, and `last_error`.
- Preflight skips for incomplete scores, unvalidated matches, missing DUPR IDs, and non-completed tournaments.

Manual sandbox QA should cover:

- Link a test player to DUPR.
- Refresh a rating.
- Complete a test tournament.
- Export validated matches to UAT.
- Confirm DUPR UAT shows the expected match payload/results.
- Confirm repeated export does not create duplicates.

## Implementation sequence

1. Complete KAN-12: obtain sandbox credentials/access.
2. KAN-14: replace DUPR stub with partner client and implement direct DUPR ID linking + rating sync in sandbox.
3. KAN-15: add export tracking migration and end-of-tournament export workflow in sandbox.
4. KAN-16: perform sandbox QA and decide whether production is safe.

## Open decisions

- Whether DUPR requires explicit user consent for rating reads under Picktennt's partner access.
- Whether DUPR prefers one match create call per match or batch upload for tournament completion.
- Exact DUPR event/club identifiers to include in payloads.
- Whether export should be admin-triggered only or eventually automatic on tournament completion. First version should be admin-triggered for safety.
