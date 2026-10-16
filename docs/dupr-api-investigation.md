# DUPR API Investigation

Date: 2026-05-09
Jira: KAN-10

## Sources checked

- Public DUPR docs: https://events.mydupr.com/docs
- Public OpenAPI: https://events.mydupr.com/v3/api-docs/public
- DUPR Partner UAT Swagger: https://uat.mydupr.com/api/swagger-ui/index.html
- Partner OpenAPI: https://uat.mydupr.com/api/v3/api-docs/DUPR%20Partner%20APIs
- Picktennt current code/schema in `C:\Users\davinci\picktennt`

## Findings

### Public DUPR API

The currently linked public API is read-oriented and built around external read-only tokens.

Relevant public endpoints:

- `POST /auth/{version}/login-read-only-token`
- `POST /auth/{version}/login-read-only-token-with-session`
- `POST /auth/{version}/consent/grant`
- `GET /auth/{version}/refresh`
- `GET /public/user/info`
- `POST /subscription/active`

Public auth requires an `x-authorization` partner/client key and user consent for PII. The public response can include user info and player rating fields through `ReadOnlyUserResponse.stats` / `PlayerRatingResponse`, but this surface does not expose match creation/upload endpoints.

### Partner API / sandbox

The UAT Partner API documentation exposes the API surface Picktennt needs for full integration:

- Auth: `POST /auth/{version}/token`
  - Requires `base64(ClientKey:ClientSecret)` in `x-authorization`.
  - Returns a bearer JWT valid for 1 hour.
- Users:
  - `POST /user/{version}/search`
  - `POST /user/{version}/batch`
  - `GET /user/{version}/{id}`
  - `GET /user/{version}/{id}/details`
- Ratings/webhooks:
  - `GET/POST/DELETE /{version}/subscribe/rating-changes`
  - `POST /{version}/webhook`
- Matches:
  - `POST /match/{version}/create`
  - `POST /match/{version}/batch`
  - `POST /match/{version}/update`
  - `GET /match/{version}/{id}`

Important match payload fields from `ExternalMatchRequest`:

- `matchDate` as `yyyy-MM-dd`
- `format`: `SINGLES` or `DOUBLES`
- `event` required
- `identifier` required and should be unique/idempotent
- `teamA` / `teamB` with DUPR IDs and game scores
- Optional `clubId`, `location`, `bracket`, `matchType`, `matchSource`, `extras`

### Paid/free/access answer

I could not confirm a public free tier from official docs. The public docs say read-only external tokens are available, but the Partner API requires client credentials and includes account-expired/support messaging, which strongly suggests DUPR must provision partner access. Match upload is not available from the public read-only docs alone.

Conclusion: assume we need a DUPR partner/sandbox account and credentials before implementing anything that submits tournament matches.

### DUPR account / credentials needed

Needed from DUPR/ED:

1. Partner Client Key
2. Partner Client Secret
3. Confirmation of sandbox/UAT URL and production URL
4. Confirmation that Picktennt is authorized for user search/batch, rating access, match create/batch, and possibly webhooks
5. If public read-only linking is used, the public `x-authorization` client key and consent-flow requirements
6. Any club ID / partner ID that DUPR expects in match payloads

## Current Picktennt state

Picktennt already has:

- `profiles.dupr_id`
- `profiles.dupr_rating`
- tournament/match/team/player schema
- match statuses including `validated`
- a stub client at `lib/dupr/client.ts`

The stub is currently not aligned with the discovered docs:

- It uses `DUPR_API_KEY` as a bearer token directly.
- It calls guessed endpoints `/v1/player/search?email=...` and `/v1/match`.
- The documented partner API uses `/auth/v1.0/token`, `/user/v1.0/search`, `/user/v1.0/batch`, and `/match/v1.0/create` or `/match/v1.0/batch`.

## Recommended implementation approach

Use a sandbox-first partner integration. Do not upload to production until sandbox is verified.

1. Store credentials server-side only.
2. Implement token acquisition/cache for partner API JWTs.
3. Add player DUPR linking:
   - use DUPR ID when user provides it;
   - optionally search/batch by name/email if permitted;
   - handle ambiguous results with admin/user confirmation.
4. Pull ratings into `profiles.dupr_rating`, with `dupr_id` as canonical link.
5. Add match export status fields or table before uploading:
   - exported/not exported
   - DUPR match id/result
   - last error
   - export attempts
6. Export only validated matches after tournament completion.
7. Use stable idempotency identifiers like `picktennt:<match_id>`.
8. Keep retry safe: never create duplicate DUPR matches for the same Picktennt match.
9. Add tests for payload mapping, token refresh, error handling, and idempotency.

## Blockers

- No DUPR partner credentials are present.
- No confirmed sandbox credentials/access yet.
- Official public docs do not show match upload.
- Production upload should remain on hold until sandbox verification succeeds.

## Jira split created

- KAN-12: DUPR credentials and sandbox access
- KAN-13: DUPR API investigation and implementation spec
- KAN-14: Implement DUPR player linking and rating sync in sandbox
- KAN-15: Implement end-of-tournament DUPR match export in sandbox
- KAN-16: DUPR sandbox QA and production go/no-go
