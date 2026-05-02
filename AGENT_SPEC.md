# Picktennt — Full Technical Specification for AI Agents

This document is the authoritative reference for the Picktennt codebase. It is written for an AI coding agent that is picking up this project cold. Read all sections before writing any code.

---

## 1. What This App Does

Picktennt is a pickleball tournament management web app. It handles the full lifecycle of a tournament:

1. A user creates a tournament (format, courts, player cap, optional second round, optional finals).
2. Players join by code, link, or public search.
3. An admin approves players and generates match rounds.
4. Players enter scores; the opposing team or an admin validates them.
5. Live standings and a leaderboard are shown throughout.
6. Optional second round and finals are generated from standings.
7. DUPR rating data is displayed on profiles (API stub ready for key insertion).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.4, App Router, TypeScript |
| Styling | Tailwind CSS v4 (CSS-native, no config file) |
| Auth & DB | Supabase (PostgreSQL + Google OAuth + RLS) |
| Hosting | Vercel (GitHub auto-deploy) |
| Repo | https://github.com/eduardoscottp/picktennt |
| Production URL | https://picktennt-bw9r.vercel.app/ |

### Critical framework quirks

**Tailwind v4:** Does NOT use `tailwind.config.ts` for theme tokens. All custom design tokens live in `app/globals.css` inside an `@theme {}` block. The file starts with `@import "tailwindcss";`. Never move tokens to the config file — they will be silently ignored.

**Next.js 16 middleware:** The middleware file is named `proxy.ts` (not `middleware.ts`) and exports `async function proxy()` (not `middleware()`). Next.js 16 changed the conventional name. The `config` export with `matcher` stays in the same file and is still recognized.

**Supabase SSR + redirects:** In `app/auth/callback/route.ts`, the `NextResponse.redirect()` object must be created FIRST, then passed into `createServerClient` so that `setAll` can set cookies directly onto that response object. If you create the redirect response after the client, cookies are lost and the session never persists.

**Supabase TypeScript generics:** Do NOT pass `<Database>` as a generic to `createBrowserClient` or `createServerClient`. The generic causes TypeScript inference failures (`never` type errors). Cast query results manually: `data as Profile`, `data as Tournament`, etc.

**Next.js 16 `params`:** Route params are now a `Promise`. Always `await params` before destructuring: `const { id } = await params;`.

---

## 3. Repository Structure

```
picktennt/
├── app/
│   ├── (app)/                        # Authenticated routes (layout checks session)
│   │   ├── layout.tsx                # Fetches user + profile, renders Navbar, redirects if unauthenticated
│   │   ├── dashboard/page.tsx        # User's tournaments (as player + as admin)
│   │   ├── profile/page.tsx          # Edit profile (name, age, DUPR ID)
│   │   └── tournaments/
│   │       ├── page.tsx              # Public tournament search
│   │       ├── create/page.tsx       # 4-step creation wizard
│   │       └── [id]/
│   │           ├── page.tsx          # Tournament detail + join button
│   │           ├── admin/page.tsx    # Admin panel (players, rounds, status)
│   │           ├── matches/page.tsx  # All matches with score entry
│   │           └── leaderboard/page.tsx  # Standings table
│   ├── auth/callback/route.ts        # OAuth callback — exchanges code, upserts profile
│   ├── join/[code]/page.tsx          # Join by code (redirects to tournament)
│   ├── login/
│   │   ├── page.tsx                  # Suspense wrapper (required by useSearchParams)
│   │   └── login-form.tsx            # Client component with Google sign-in button
│   ├── page.tsx                      # Landing page (public)
│   ├── layout.tsx                    # Root layout — ToastProvider, metadata, viewport
│   └── globals.css                   # Tailwind v4 import + @theme tokens + base styles
├── components/
│   ├── layout/
│   │   ├── navbar.tsx                # Top bar (desktop) + bottom nav (mobile) + MobileHeader
│   ├── tournament/
│   │   ├── admin-generate-round.tsx  # Generate next round (client, calls Supabase + pairing algo)
│   │   ├── admin-player-actions.tsx  # Approve / reject player (client)
│   │   ├── admin-status-actions.tsx  # Advance tournament status (client)
│   │   ├── join-button.tsx           # Join / cancel join (client)
│   │   ├── score-entry-button.tsx    # Enter + validate + dispute score (client)
│   │   └── share-button.tsx          # Copy join link / code (client)
│   ├── auth/
│   │   └── edit-profile-form.tsx     # Edit profile form (client)
│   └── ui/
│       ├── avatar.tsx                # Avatar + AvatarImage + AvatarFallback
│       ├── badge.tsx                 # Badge (variant: default | secondary | success | danger)
│       ├── button.tsx                # Button (variant, size, loading prop)
│       ├── card.tsx                  # Card + CardHeader + CardTitle + CardContent
│       ├── dialog.tsx                # Modal dialog
│       ├── input.tsx                 # Input with label, hint, error props
│       ├── select.tsx                # Select + SelectTrigger + SelectContent + SelectItem
│       └── toast.tsx                 # ToastProvider + useToast hook
├── lib/
│   ├── supabase/
│   │   ├── client.ts                 # createClient() for client components
│   │   └── server.ts                 # createClient() + createAdminClient() for server components
│   ├── tournament/
│   │   ├── mixed-pairing.ts          # Social Golfer greedy algorithm
│   │   └── standings.ts              # computeStandings() + buildParMatchBracket()
│   ├── dupr/
│   │   └── client.ts                 # DUPR API stub (getDuprPlayerByEmail, submitDuprMatch)
│   └── utils.ts                      # cn, formatDate, getInitials, generateJoinUrl, statusLabel, etc.
├── types/
│   └── database.ts                   # All TypeScript interfaces + Database type
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql    # Complete schema — run once in Supabase SQL editor
├── public/
│   ├── images/logo.png               # App logo
│   └── manifest.json                 # PWA manifest
├── proxy.ts                          # Next.js 16 middleware (named proxy, not middleware)
├── next.config.ts                    # Image domains: lh3.googleusercontent.com, *.supabase.co
├── tailwind.config.ts                # Empty — only exists for TypeScript type; theme is in globals.css
└── .env.local                        # Local secrets (never commit)
```

---

## 4. Environment Variables

All must be set both in `.env.local` (local) and in Vercel project settings (production).

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
NEXT_PUBLIC_APP_URL=https://picktennt-bw9r.vercel.app   # localhost:3000 locally
DUPR_API_KEY=                                            # empty until DUPR account obtained
DUPR_API_BASE_URL=https://api.dupr.gg
```

`NEXT_PUBLIC_APP_URL` is used by `generateJoinUrl()` in `lib/utils.ts` to build shareable join links.

---

## 5. Database Schema

Run `supabase/migrations/001_initial_schema.sql` once in the Supabase SQL editor. It is idempotent only for functions (uses `CREATE OR REPLACE`). Tables use plain `CREATE TABLE` — to re-run after a partial failure, drop all tables first.

### Tables

#### `profiles`
Extends `auth.users`. Created automatically by the `handle_new_user` trigger (with `ON CONFLICT DO NOTHING` to be safe). Also upserted in the auth callback route as a fallback.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | References auth.users(id) |
| email | TEXT | |
| first_name | TEXT | From Google `given_name` |
| last_name | TEXT | From Google `family_name` |
| age | INTEGER | User-set |
| avatar_url | TEXT | From Google `picture` or `avatar_url` |
| dupr_id | TEXT | Manual entry |
| dupr_rating | NUMERIC(4,2) | Synced from DUPR API |
| is_system_admin | BOOLEAN | Manually set in DB |

#### `tournaments`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT UNIQUE | Unique constraint — catch error code `23505` for friendly message |
| created_by | UUID | References profiles(id) |
| court_count | INTEGER | Min 1 |
| max_players | INTEGER | Min 2 |
| type | TEXT | `singles` \| `doubles` \| `mixed` |
| games_per_player | INTEGER | Mixed only — target games each player plays |
| second_round_format | TEXT | `round_robin` \| `par_match` \| `none` |
| advancement_count | INTEGER | How many players advance to second round |
| finals_format | TEXT | `top2` \| `top4` \| `none` |
| finals_trigger | TEXT | `after_elimination` \| `after_round_robin` \| `none` |
| join_code | TEXT UNIQUE | Auto-generated 8-char uppercase UUID prefix |
| rules_text | TEXT | Optional admin-written rules |
| status | TEXT | `draft` → `registration` → `active` → `finals` → `completed` |
| is_public | BOOLEAN | Whether name appears in public search |

#### `tournament_admins`
The creator is automatically added as admin #1 by the `handle_new_tournament` trigger. Admins have a `succession_order`; the lowest number is the primary admin. When an admin is deleted, orders are recompacted by `handle_admin_deleted`.

#### `tournament_players`
Tracks join requests. `status` is `pending` until an admin approves. `joined_via` records how they found the tournament.

#### `teams`
- Singles: 1 team = 1 player. Team name = player name.
- Doubles: 1 team = 2 players. Fixed for the tournament.
- Mixed: teams are ephemeral — created per-match by the pairing algorithm. Not stored as persistent teams.

#### `team_members`
Junction table: `(team_id, user_id)` with a UNIQUE constraint. No other unique constraints.

#### `rounds`
Each round has a `round_type`: `round_robin`, `par_match`, `elimination`, `finals_gold`, `finals_bronze`. Status flows `pending` → `active` → `completed`.

#### `matches`
- Singles/Doubles: uses `team_a_id` + `team_b_id`.
- Mixed: uses `player_a1_id`, `player_a2_id`, `player_b1_id`, `player_b2_id` directly (no team rows).
- Score flow: `scheduled` → `in_progress` → `score_entered` → `validated` (or `disputed`).
- `entered_by`: the user who submitted the score.
- `validated_by`: the opposing team member or admin who confirmed it.

#### `standings`
Cached standings per round. Either `team_id` (singles/doubles) or `player_id` (mixed) is set, not both. Recomputed after each match validation by calling `computeStandings()` in `lib/tournament/standings.ts` and upserting.

#### `mixed_pairings`
Tracks how many times each player pair has been partners vs opponents. Used by the pairing algorithm to minimize repeats. Always stored with `player_a_id < player_b_id` alphabetically (canonical direction).

### Triggers

| Trigger | Function | When |
|---|---|---|
| `on_auth_user_created` | `handle_new_user()` | After INSERT on auth.users |
| `on_tournament_created` | `handle_new_tournament()` | After INSERT on tournaments |
| `on_admin_deleted` | `handle_admin_deleted()` | After DELETE on tournament_admins |
| `profiles_updated_at` | `update_updated_at()` | Before UPDATE on profiles |
| `tournaments_updated_at` | `update_updated_at()` | Before UPDATE on tournaments |
| `matches_updated_at` | `update_updated_at()` | Before UPDATE on matches |

### Row Level Security

RLS is enabled on all tables. Policies are documented inline in the SQL migration. Key rules:

- **profiles**: readable by everyone, writable only by owner.
- **tournaments**: public ones readable by all; private ones only by members/admins.
- **tournament_players**: players see their own row; admins see all.
- **matches — score entry**: any participant OR admin can update when status is `scheduled/in_progress/score_entered/disputed`.
- **rounds/standings**: readable by approved players and admins.

**RLS recursion warning:** Avoid writing policies that cross-reference `tournament_admins` ↔ `tournament_players` directly in `USING` clauses — Postgres detects circular references and throws an infinite recursion error. If this happens, extract the check into a `SECURITY DEFINER` SQL function and call it from the policy.

---

## 6. Authentication Flow

1. User clicks "Sign in with Google" on `/login`.
2. `login-form.tsx` calls `supabase.auth.signInWithOAuth({ provider: "google", redirectTo: "${APP_URL}/auth/callback" })`.
3. Supabase redirects to Google, then back to `/auth/callback?code=...`.
4. `app/auth/callback/route.ts`:
   - Creates `NextResponse.redirect(origin + next)` first.
   - Creates `createServerClient` with `setAll` writing cookies to that redirect response.
   - Calls `supabase.auth.exchangeCodeForSession(code)`.
   - On success, upserts `profiles` row (fallback in case trigger failed).
   - Returns the redirect response (with session cookies attached).
5. User lands on `/dashboard`.

**Supabase config required:**
- Google provider enabled in Supabase Auth → Providers.
- Site URL set to production URL.
- Redirect URL `https://picktennt-bw9r.vercel.app/auth/callback` added to allowed list.

---

## 7. Middleware (proxy.ts)

```typescript
export async function proxy(request: NextRequest) { ... }
export const config = { matcher: [...] };
```

Protected paths: `/dashboard`, `/profile`, `/tournaments/create`.

Unauthenticated requests to these paths redirect to `/login?redirect=<pathname>`.

The login page reads the `redirect` search param and passes it as `next` to the OAuth flow, so after login the user lands on their intended page.

---

## 8. Tournament Lifecycle State Machine

```
draft → registration → active → finals → completed
```

- `draft`: Created but not accepting players.
- `registration`: Players can join; admin can approve/reject.
- `active`: Admin generates rounds; players enter scores.
- `finals`: Finals matches are generated (top 2 or top 4).
- `completed`: Tournament over; leaderboard is final.

Transitions are triggered by the admin via `AdminStatusActions` component (client-side Supabase update).

---

## 9. Tournament Types

### Singles
- Each player is their own team (1 member).
- Round robin or par match format.
- Standings: team wins/losses, tiebreaker by points against.

### Doubles
- Players form fixed 2-person teams before the tournament starts.
- Admin must create teams and assign members before generating rounds.
- Same round formats as singles.

### Mixed
- No fixed teams. Partners rotate every round.
- The pairing algorithm (`lib/tournament/mixed-pairing.ts`) generates match schedules.
- Standings are individual (player-level), not team-level.
- Second round option: top N players form new teams seeded 1+N, 2+(N-1), etc.

---

## 10. Pairing Algorithm (Mixed Tournaments)

File: `lib/tournament/mixed-pairing.ts`

**Problem:** Given N players and C courts, generate G rounds of 4-player matches (2v2) that minimize repeated partners and opponents (Social Golfer Problem variant).

**Algorithm:**
1. Track a `PairingMatrix[playerA][playerB] = { partner: n, opponent: n }`.
2. For each round:
   - Prioritize players who sat out most recently.
   - Run 20 random shuffle attempts (greedy with restart).
   - For each group of 4 players, try all 3 ways to split into 2v2 teams.
   - Choose the split with the lowest penalty score (repeated interactions penalized quadratically).
   - Pick the attempt with the lowest total round penalty.
3. Update the matrix after each round.

**Key functions:**
- `generateMixedSchedule(players, courts, totalGames)` — returns array of `MixedRound`.
- `buildMixedSecondRoundTeams(rankedPlayerIds)` — pairs 1st+last, 2nd+2nd-last, etc.

---

## 11. Standings & Tiebreaker

File: `lib/tournament/standings.ts`

**`computeStandings(matches, entityKey)`**

- Filters to `validated` matches only.
- Accumulates wins, losses, points_for, points_against per team or player.
- Draws give 0.5 wins to each side.
- Sort order: wins descending, then points_against ascending (fewer points conceded = better rank).

**`buildParMatchBracket(rankedIds)`**

Pairs 1st vs last, 2nd vs 2nd-last, etc. Returns `Array<[id, id]>`.

---

## 12. Score Entry Flow

1. Match is in `scheduled` or `in_progress` state.
2. Any participant or admin opens the score dialog (`ScoreEntryButton`).
3. They submit scores → match status becomes `score_entered`, `entered_by` = their user ID.
4. The opposing team or an admin sees "Validate Score" and "Dispute" buttons.
5. Validate → `validated`, `validated_by` = their user ID.
6. Dispute → `disputed` → anyone can re-enter score.
7. On validation, the caller should recompute standings (upsert `standings` rows).

**RLS on matches:** The `matches_enter_score` policy allows UPDATE when the user is a team member (via `team_members`) or one of the 4 player slots (mixed), and the match is in an editable status.

---

## 13. Design System

**Colors (brand palette — defined in `app/globals.css`):**

| Token | Hex |
|---|---|
| `brand-50` | `#e6f7fa` |
| `brand-100` | `#c0eaf2` |
| `brand-200` | `#8dd6e8` |
| `brand-300` | `#55bfd9` |
| `brand-400` | `#2bafc7` |
| `brand-500` | `#2bafc7` (primary) |
| `brand-600` | `#2097ad` |
| `brand-700` | `#177d90` |
| `brand-800` | `#0f6273` |
| `brand-900` | `#084a57` |

Use as `bg-brand-500`, `text-brand-600`, `border-brand-200`, etc.

**Layout:**
- Mobile-first. Max content width `max-w-2xl` or `max-w-lg` for forms.
- Desktop: sticky top navbar (`hidden md:flex`).
- Mobile: sticky bottom nav (`md:hidden fixed bottom-0`). Create button floats above the nav bar with `-top-4` offset.
- `MobileHeader` component for page titles on mobile with optional back button.
- Body background: `#f8f9fa`. Text: `#1a1d23`.

**Component API:**

```tsx
<Button variant="primary|secondary|outline|danger|white" size="sm|md|lg|xl" loading={bool}>
<Input label="..." hint="..." error="..." />
<Select>
  <SelectTrigger label="..." error="..."><SelectValue /></SelectTrigger>
  <SelectContent><SelectItem value="...">...</SelectItem></SelectContent>
</Select>
<Badge variant="default|secondary|success|danger" />
<Card><CardHeader><CardTitle /></CardHeader><CardContent /></Card>
<Dialog open={bool} onOpenChange={fn}><DialogContent>...</DialogContent></Dialog>
<Avatar><AvatarImage src="..." /><AvatarFallback>AB</AvatarFallback></Avatar>
```

**Toast:**
```tsx
const { toast } = useToast();
toast("Message", "success" | "error" | "info");
```

---

## 14. Supabase Client Usage

**In server components / route handlers:**
```typescript
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
```

**In client components:**
```typescript
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

**Admin operations** (bypasses RLS — use only in trusted server contexts):
```typescript
import { createAdminClient } from "@/lib/supabase/server";
const supabase = await createAdminClient(); // uses SUPABASE_SERVICE_ROLE_KEY
```

**TypeScript pattern:** Cast results manually, never rely on inference:
```typescript
const { data } = await supabase.from("profiles").select("*").eq("id", id).single();
const profile = data as Profile | null;
```

---

## 15. DUPR Integration (Stub)

File: `lib/dupr/client.ts`

Both functions are fully implemented but no-op when `DUPR_API_KEY` is empty.

- `getDuprPlayerByEmail(email)` → `DuprPlayer | null` — searches DUPR by email.
- `submitDuprMatch(result)` → `boolean` — posts match result to DUPR.

To activate: get a DUPR developer account, add the key to env vars, and call these functions after match validation.

The `dupr_id` and `dupr_rating` columns on `profiles` are ready. The `duprRatingColor(rating)` utility in `lib/utils.ts` maps rating ranges to Tailwind color classes.

---

## 16. Join by Code / Link

- Each tournament has a unique 8-character `join_code` (uppercase, auto-generated from UUID).
- `generateJoinUrl(joinCode)` returns `${NEXT_PUBLIC_APP_URL}/join/${joinCode}`.
- `app/join/[code]/page.tsx` looks up the tournament by code and redirects to `/tournaments/[id]`.
- `join-button.tsx` handles the join request (INSERT into `tournament_players` with `status: "pending"`).
- The share button copies the URL or code to clipboard.

---

## 17. Public Tournament Search

`app/(app)/tournaments/page.tsx` queries tournaments where `is_public = true`. Shows only the tournament name, type, status, and player count. No private information is exposed.

---

## 18. Admin Panel

`app/(app)/tournaments/[id]/admin/page.tsx` — server component, checks admin membership, redirects non-admins.

Features:
- **Status controls** (`AdminStatusActions`): advance tournament through the state machine.
- **Round generation** (`AdminGenerateRound`): select round type, call pairing algorithm, insert round + matches.
- **Player management** (`AdminPlayerActions`): approve or reject pending players.
- **Admin succession**: list of admins in order. The trigger auto-reorders on deletion.
- **Join code + share link** displayed prominently.

---

## 19. Known Issues & Fixes Applied

| Issue | Root Cause | Fix |
|---|---|---|
| Session lost after OAuth | Cookies set on wrong response object | Create `NextResponse.redirect` before `createServerClient`; pass response into `setAll` |
| `Database error saving new user` | Google sends `picture` not `avatar_url`; trigger crashed | Add `COALESCE` for both fields; add `EXCEPTION WHEN OTHERS THEN RETURN NEW`; add profile upsert in callback |
| Infinite RLS recursion | `tournament_players` ↔ `tournament_admins` circular policy | Use `SECURITY DEFINER` SQL functions as policy checks |
| Foreign key on tournament INSERT | Profile row didn't exist yet | Profile upsert in callback before tournament insert; added `profiles_insert_own` INSERT policy |
| Brand colors showing white | Tailwind v4 ignores config file | Moved all `--color-brand-*` into `globals.css` `@theme {}` block |
| `column "tournament_id_user_id" named in key does not exist` | Malformed UNIQUE constraint | Fixed — only `UNIQUE (team_id, user_id)` remains in `team_members` |
| `useSearchParams()` without Suspense | Next.js App Router requirement | Split login page into `page.tsx` (Suspense) + `login-form.tsx` (client) |
| Duplicate tournament name | Postgres unique constraint | Catch `err.code === "23505"` or `err.message.includes("tournaments_name_key")`, show inline field error, jump back to step 0 |

---

## 20. What Is NOT Yet Built

These features are designed and stubbed but not yet implemented:

1. **Doubles team formation UI** — players need a way to create/join teams before the tournament goes active.
2. **Standings auto-recompute** — after a match is validated, the standings table should be updated automatically (currently must be done manually or triggered by an admin action).
3. **Admin: promote player to co-admin** — the succession table exists but there is no UI to add co-admins.
4. **DUPR sync** — API key needed; the stub is ready.
5. **Admin: complete tournament** — advancing to `completed` and generating a final leaderboard snapshot.
6. **Push / real-time notifications** — Supabase Realtime subscriptions not yet wired up.
7. **System admin panel** — `is_system_admin` flag exists on profiles but there is no `/admin` route yet.
8. **Mixed second round seeding** — `buildMixedSecondRoundTeams()` exists in `lib/tournament/mixed-pairing.ts` but is not yet called from the UI.
9. **Profile DUPR ID linking** — the profile edit form accepts a DUPR ID but does not validate it against the API.

---

## 21. Deployment

**GitHub → Vercel auto-deploy:**
- Every push to `master` triggers a Vercel production deployment.
- Environment variables are configured in the Vercel project settings (not `.env.local`).
- The `.vercel` directory is in `.gitignore`.

**To deploy manually:**
```bash
npx vercel --prod
```

**To check env vars on the correct project:**
```bash
npx vercel link --project picktennt-bw9r --yes
npx vercel env ls
```

Note: there are two Vercel projects (`picktennt` and `picktennt-bw9r`). The production app is `picktennt-bw9r`. The CLI may link to the wrong one — always verify with `vercel env ls` before adding/changing variables.

---

## 22. Local Development

```bash
cd /c/Users/davinci/picktennt   # or wherever the repo is cloned
npm install
npm run dev                      # starts on http://localhost:3000
```

Ensure `.env.local` has all variables from Section 4 with `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

The Supabase Google OAuth redirect must include `http://localhost:3000/auth/callback` in the allowed list in Supabase Auth settings.

---

## 23. File-by-File Quick Reference

| File | Purpose |
|---|---|
| `app/globals.css` | Tailwind v4 base + brand color tokens + scrollbar + focus styles |
| `app/layout.tsx` | Root HTML shell, ToastProvider, metadata |
| `app/(app)/layout.tsx` | Auth check + Navbar + main padding |
| `app/auth/callback/route.ts` | OAuth code exchange + profile upsert |
| `proxy.ts` | Route protection middleware |
| `lib/supabase/client.ts` | Browser Supabase client |
| `lib/supabase/server.ts` | Server Supabase client (cookies via next/headers) |
| `lib/tournament/mixed-pairing.ts` | Social Golfer greedy algorithm |
| `lib/tournament/standings.ts` | Win/loss aggregation + par match seeding |
| `lib/dupr/client.ts` | DUPR API stub |
| `lib/utils.ts` | Helpers: cn, formatDate, getInitials, generateJoinUrl, statusLabel |
| `types/database.ts` | All TypeScript types for DB rows and enriched views |
| `supabase/migrations/001_initial_schema.sql` | Complete Postgres schema with RLS |
| `components/tournament/admin-generate-round.tsx` | Client: generate round + insert matches |
| `components/tournament/score-entry-button.tsx` | Client: submit + validate + dispute score |
| `next.config.ts` | Image domains + serverActions body limit |
