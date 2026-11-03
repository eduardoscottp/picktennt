# Isolated tournament staging package

This package prepares an empty Supabase staging database. It does not provision a project, enable billing, deploy Vercel, copy production data, read credentials, or apply remotely. Do not run hosted setup until the coordinator has the user's staging/cost decision.

## Recommended target

Use a **new empty isolated project** after the account's pricing/availability is approved. The existing production migration history contains only 14 scoreboard/profile migrations and omits the initial tournament/Sessions schema. A branch reconstructed solely from that history cannot be assumed to contain the required core. An existing branch may also contain partial tables, which this package deliberately refuses to replace.

The baseline is a core-only snapshot of catalog metadata read on 2026-10-28: ten public tables, 103 columns with exact PostgreSQL types/defaults, 65 constraints, 32 indexes including constraint indexes, 28 RLS policies, ten required helper/trigger functions, and the two auth-to-profile triggers. It contains no user rows, token values, credentials, Sessions/scoreboard tables, or unrelated RPCs. It does not turn the test target into a complete Android/Wear backend.

## Files applied, in order

1. `scripts/tournament-builder/staging-baseline.sql`
2. `supabase/migrations/202610280001_tournament_builder.sql`
3. `supabase/migrations/202610280002_tournament_connector_oauth.sql`

Never run `supabase db push` against this checkout for this setup: the legacy migration folder is not the authoritative deployed history. The generator selects only the three files above and reports their SHA256 hashes. It combines them into one transaction, so an error rolls back the entire setup.

The baseline requires managed `auth.users`, `auth.uid()` and the standard API roles. It rejects production project ref `qmiljmxnnryhuaudpuff`, missing/invalid target refs, any existing public user relation/custom routine, an existing builder private schema, any auth user, or custom public-function auth triggers. It never drops unknown schemas/tables. Re-running after successful setup intentionally fails the empty-project guard.

## Prepare and review locally

Run from the application root. Replace the placeholder with the coordinator's verified new staging ref:

```powershell
$StagingRef = '<verified-new-20-character-ref>'
node scripts/tournament-builder/setup-staging.mjs --project-ref $StagingRef
node scripts/tournament-builder/setup-staging.mjs --project-ref $StagingRef --output ../verification-local/reviewed-staging-apply.sql
```

The first command prints only the selected plan/hashes. The second writes a local SQL bundle and refuses to overwrite a pre-existing file. Neither sends a network request. Review the exact bundle and hashes before approval/application.

## After project and exact SQL application are approved

Check the destination using the existing Supabase CLI login. Confirm the project ref/name/region and that it is the intended isolated project:

```powershell
npx --yes supabase projects list --output json
npx --yes supabase db query --linked --project-ref $StagingRef --output json "SELECT current_database(), (SELECT count(*) FROM auth.users) AS auth_users, (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_tables;"
```

Apply only the reviewed bundle after authorization:

```powershell
npx --yes supabase db query --linked --project-ref $StagingRef --file ../verification-local/reviewed-staging-apply.sql --output json
```

Do not substitute the production ref. The SQL contains independent empty-project guards; a guard failure means inspect the target, not remove or bypass the guard. Keep credential values in the host credential store or process environment. Do not save keys, passwords or sessions alongside this package.

This bootstrap is intentionally separate from production migration history. Keep the generated hash manifest and application output as staging evidence. Do not fabricate historical applied migrations or add this baseline to production.

## Isolated Vercel preview wiring

The existing Vercel project's Supabase and Google variables currently have shared production/preview targets. An ordinary preview deployment therefore is not sufficient isolation. Before any hosted write tests, use a separately verified staging Vercel project or explicitly isolated branch-scoped preview settings pointing exclusively at the new staging Supabase URL and keys. Configure staging Auth Site URL/allowed redirects and Google/Apple providers separately if those sign-in journeys are needed. Do not copy production OAuth provider secrets into documentation.

Current runtime gates are `TOURNAMENT_BUILDER_ENABLED=true`, `MCP_ENABLED=true`, and `APP_ORIGIN` set to the isolated deployment origin. Supabase clients use `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`; configure staging values only. Recheck the current source before configuration; this README does not mutate settings. Keep production flags and credentials out of the staging plan.

## Local verification

```powershell
npx tsx --test tests/tournament-builder/staging-baseline.test.ts
```

The tests create a PGlite managed-Auth shell, reconstruct the exact core-only baseline, apply both actual named migrations, create a synthetic profile through the Auth trigger, execute the trusted command boundary and register an opaque OAuth client. They also prove production/nonempty-target refusal and unknown-table preservation. These are local tests, not hosted evidence.

## Prepared hosted concurrency check — not run

`hosted-concurrency.mjs` sends no requests without `--run`, an exact nonproduction URL/ref match, and `TB_HOSTED_CONCURRENCY_ALLOW=1`. It requires the following staging values already present in the process environment:

- `TB_STAGING_SUPABASE_URL`
- `TB_STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `TB_STAGING_SUPABASE_ANON_KEY`

After staging/write-test authorization and applying the reviewed bundle:

```powershell
node scripts/tournament-builder/hosted-concurrency.mjs --run --project-ref $StagingRef
```

The harness creates one synthetic Auth user with an in-process random password, verifies an ordinary authenticated user cannot call trusted effects, races two identical create operations, races two different writes at the same revision, checks the committed revision, and cancels its synthetic event through the command RPC. It prints only safe run/event IDs and check names. Synthetic rows and receipts remain for audit; it never deletes existing users/tables or prints keys/passwords/tokens. A failing run may leave synthetic staging fixtures for investigation.

Actual hosted Postgres, PostgREST, provider login, Vercel routes, and ChatGPT/Claude connector acceptance remain separate checks. No hosted setup or concurrency execution is claimed by this package.

