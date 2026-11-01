# Sign in with Apple — Web setup handoff (IDD-5)

**Status:** Apple web provider is NOT yet configured. The web login currently shows Apple as
"visibly unavailable". This document contains every value and step needed to finish it.

**Owner action required:** The Apple Developer portal steps (Part B) require signing in to
developer.apple.com as `es@idddeas.com` with password + 2FA. An assistant cannot enter an
account password or complete 2FA. Once you are signed in, the rest can be clicked through.

**Secrets rule:** The `.p8` private key and the generated client-secret JWT are secrets.
They must NOT be committed to the repo or pasted into the Linear ticket. They go only into
Supabase provider config (Part C) or a secret store.

---

## 1. Known / derived values (no login needed)

| Thing | Value | Source |
| --- | --- | --- |
| Apple Developer account | `es@idddeas.com` | portal login prompt |
| Primary App ID (iOS app bundle) | `Idddeas.Picktennt` | Picktennt-iOS `project.pbxproj` |
| Supabase project ref | `qmiljmxnnryhuaudpuff` | deployed site JS (`NEXT_PUBLIC_SUPABASE_URL`) |
| Supabase URL | `https://qmiljmxnnryhuaudpuff.supabase.co` | same |
| **Apple Return URL (Supabase callback)** | `https://qmiljmxnnryhuaudpuff.supabase.co/auth/v1/callback` | Supabase OAuth convention |
| Web domains (live) | `app.picktennt.com` (primary), `picktennt-bw9r.vercel.app` | AGENT_SPEC.md + comments |
| App return (post-auth) | `https://app.picktennt.com/auth/callback` | existing Google flow (`/auth/callback`) |
| Auth model | Supabase-hosted OAuth: `signInWithOAuth({provider})` → Supabase → Apple → Supabase callback → app `/auth/callback` | AGENT_SPEC.md §Auth |

### Still unknown until someone signs in to the portal
- **Team ID** (10 chars) — top-right of developer.apple.com, or Membership page.
- **Services ID** (web client_id) — must be CREATED (Part B.2). Recommended: `com.picktennt.web`.
- **Key ID** (10 chars) + **`.p8` private key** — must be CREATED (Part B.3).

---

## 2. Part A — Confirm the Primary App ID

The iOS app `Idddeas.Picktennt` already uses Sign in with Apple natively, so the capability
should already be on. Verify once signed in:

1. developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers**.
2. Open `Idddeas.Picktennt`. Confirm **Sign In with Apple** capability is checked.

---

## 3. Part B — Apple Developer portal (requires login)

### B.1 Record the Team ID
Membership / top-right of the portal. 10-character string. NOT a secret — put it in the ticket.

### B.2 Create the Services ID (this is the web `client_id`)
1. Identifiers → **+** → **Services IDs** → Continue.
2. Description: `Picktennt Web`. Identifier: **`com.picktennt.web`**. Register.
3. Open it, tick **Sign In with Apple**, click **Configure**:
   - **Primary App ID:** `Idddeas.Picktennt`
   - **Domains and Subdomains:** `qmiljmxnnryhuaudpuff.supabase.co`
     (optionally also `app.picktennt.com`)
   - **Return URLs:** `https://qmiljmxnnryhuaudpuff.supabase.co/auth/v1/callback`
4. Save / Continue / Save.

### B.3 Create the Sign in with Apple Key (.p8)
1. **Keys** → **+**.
2. Name: `Picktennt Sign in with Apple`. Tick **Sign In with Apple** → **Configure** →
   Primary App ID `Idddeas.Picktennt` → Save.
3. Register → **Download** the `.p8`. **You can only download it once.** Store it securely.
4. Record the **Key ID** (10 chars).

After B you will have: Team ID, Services ID (`com.picktennt.web`), Key ID, and the `.p8` file.

---

## 4. Part C — Supabase provider config (secrets live here)

Dashboard → project `qmiljmxnnryhuaudpuff` → Authentication → Providers → **Apple** → Enable.

- **Client IDs:** `com.picktennt.web,Idddeas.Picktennt`
  (web Services ID first; the native bundle id lets native Apple tokens validate too)
- **Secret Key (for OAuth):** the ES256 **client-secret JWT** generated from the `.p8` (below).

Also under Authentication → URL Configuration, confirm these redirect URLs are allowed
(Google already uses them):
`https://app.picktennt.com/auth/callback`, `https://picktennt-bw9r.vercel.app/auth/callback`,
`http://localhost:3000/auth/callback`.

### Generating the client-secret JWT
Apple's web client secret is a short-lived ES256 JWT (max 6 months — needs rotation).
- header: `{ "alg": "ES256", "kid": "<KEY_ID>" }`
- claims: `iss=<TEAM_ID>`, `iat=<now>`, `exp=<now + up to 15777000s>`,
  `aud="https://appleid.apple.com"`, `sub="com.picktennt.web"`
- sign with the `.p8` private key.

Node one-off (do NOT commit output):
```js
// node gen-apple-secret.mjs  (needs: npm i jsonwebtoken)
import jwt from "jsonwebtoken";
import fs from "fs";
const TEAM_ID = "<TEAM_ID>";
const KEY_ID = "<KEY_ID>";
const SERVICES_ID = "com.picktennt.web";
const key = fs.readFileSync("./AuthKey_<KEY_ID>.p8");
const now = Math.floor(Date.now() / 1000);
console.log(jwt.sign(
  { iss: TEAM_ID, iat: now, exp: now + 15552000, aud: "https://appleid.apple.com", sub: SERVICES_ID },
  key, { algorithm: "ES256", keyid: KEY_ID }
));
```
> Supabase auto-rotates the Apple secret if you paste the `.p8` where supported; otherwise
> set a reminder to regenerate before `exp`.

---

## 5. Part D — App code (Codex, in eduardoscottp/picktennt)

Mirror the existing Google flow (AGENT_SPEC.md §Auth, `login-form.tsx`, `app/auth/callback/route.ts`).

1. Add a **Continue with Apple** button to the login/sign-up form, styled to match the
   production palette (`#2BAFC7` family; Eduardo asked for the Apple/Google icons on the
   buttons — see IDD-6 comment). Call:
   ```ts
   await supabase.auth.signInWithOAuth({
     provider: "apple",
     options: { redirectTo: `${APP_URL}/auth/callback` },
   });
   ```
2. `/auth/callback` already handles `exchangeCodeForSession` — no provider-specific change
   expected, but verify Apple's `code` round-trips the same way Google's does.
3. Handle Apple specifics:
   - Apple returns name/email **only on first authorization**; later sign-ins don't. Don't
     overwrite an existing profile with empty values.
   - Support **Hide My Email** private-relay addresses (`@privaterelay.appleid.com`).
   - Handle user cancellation / denial without creating a partial authenticated UI.
4. **Account policy (per IDD-5 update 2026-11-01):** Eduardo confirmed "merge matching email."
   Use Supabase's automatic identity linking for matching **verified** emails within the
   project. Do not build custom merge/rewrite logic or merge UI. Verify the resulting user ID
   and profile/history continuity for an existing iOS Apple user.
5. Remove the "Apple unavailable" placeholder message once the provider is live.

### Verify (from IDD-5 acceptance criteria)
- New web user registers via Apple → usable account.
- Existing iOS Apple user (incl. private-relay) signs in on web → same user ID + data.
- Cancellation, returning-login-without-name/email, duplicate submit guarded.
- Google + existing mobile flows still work. No secrets in logs/analytics.
- QA on desktop Chrome, Android Chrome, iOS Safari.

---

## 6. Quick checklist

- [ ] A: `Idddeas.Picktennt` has Sign In with Apple enabled
- [ ] B.1: Team ID recorded
- [ ] B.2: Services ID `com.picktennt.web` created + configured (domain + return URL above)
- [ ] B.3: Key created, `.p8` downloaded, Key ID recorded
- [ ] C: Supabase Apple provider enabled with Client IDs + secret JWT; redirect URLs allowed
- [ ] D: Apple button + flow shipped, placeholder removed, policy + QA verified
