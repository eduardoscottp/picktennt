# KAN-9 Next Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the auth, stats, bracket, standings, logo, and in-tournament navigation issues from KAN-9 as small verified changes.

**Architecture:** Keep auth routing in `proxy.ts`, `app/page.tsx`, and `app/login/login-form.tsx`; isolate reusable tournament UI in `components/tournament/*`; extract pure dashboard stat helpers into `lib/tournament/player-stats.ts`; update bracket generation UI in `components/tournament/admin-generate-round.tsx` without changing database shape because `tournaments.advancement_count` already exists.

**Tech Stack:** Next.js 16 app router, React 19, Supabase SSR/client auth, TypeScript, Tailwind, existing ESLint/build gates.

---

## File map

- Modify `proxy.ts`: protect `/tournaments` and preserve full path/search on login redirects.
- Modify `app/page.tsx`: make both home-screen CTA buttons enter authenticated destinations with explicit `redirect` params.
- Modify `app/login/login-form.tsx`: sanitize redirect targets and encode callback `next`.
- Modify `app/auth/callback/route.ts`: sanitize `next` and avoid open redirects.
- Modify `components/layout/navbar.tsx`: use all-blue wordmark on light backgrounds and add tournament sticky nav component.
- Create `components/tournament/tournament-bottom-nav.tsx`: sticky bottom nav inside tournament routes.
- Modify tournament pages: `app/(app)/tournaments/[id]/page.tsx`, `admin/page.tsx`, `leaderboard/page.tsx`, `matches/page.tsx` to include sticky nav.
- Create `lib/tournament/player-stats.ts`: pure validated match participation/win counting.
- Modify `app/(app)/dashboard/page.tsx`: use the stats helper and include all player positions/team memberships.
- Modify `components/tournament/admin-generate-round.tsx`: always show View Tournament once rounds/bracket exist; allow Top 4/Top 8 selection when bracket not generated; remove reversed bracket insertion so round order is elimination, bronze, final.
- Modify `app/(app)/tournaments/[id]/leaderboard/page.tsx`: doubles standings display `Player A / Player B` only.
- Run `npm run lint` and `npm run build` before final status.

---

### Task 1: Auth redirect and production session stability

**Files:**
- Modify: `proxy.ts`
- Modify: `app/page.tsx`
- Modify: `app/login/login-form.tsx`
- Modify: `app/auth/callback/route.ts`

- [ ] **Step 1: Add redirect sanitizing in login form and callback**

Use only same-origin paths. In `login-form.tsx`, compute:

```ts
const rawRedirect = searchParams.get("redirect") ?? "/dashboard";
const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";
const callbackUrl = new URL("/auth/callback", window.location.origin);
callbackUrl.searchParams.set("next", redirect);
```

Then pass `redirectTo: callbackUrl.toString()`.

In `app/auth/callback/route.ts`, replace the raw `next` fallback with the same safety rule before redirecting.

- [ ] **Step 2: Protect tournaments routes**

In `proxy.ts`, include `/tournaments` in `protectedPaths`, and when redirecting to login preserve `pathname + search`:

```ts
loginUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
```

- [ ] **Step 3: Update home-screen buttons**

In `app/page.tsx`, set Browse Tournaments to `/login?redirect=/tournaments` and Get Started to `/login?redirect=/dashboard`.

- [ ] **Step 4: Verify**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass. Manual QA: production home buttons should login once and land on `/dashboard` or `/tournaments`.

- [ ] **Step 5: Commit**

```bash
git add proxy.ts app/page.tsx app/login/login-form.tsx app/auth/callback/route.ts
git commit -m "KAN-17 KAN-18 fix auth redirects"
```

---

### Task 2: Logo color normalization

**Files:**
- Modify: `components/layout/navbar.tsx`
- Modify: `app/login/login-form.tsx`

- [ ] **Step 1: Change light-background wordmarks to all brand blue**

Use `text-brand-500` for the full `PICKTENNT` wordmark in navbar and login.

- [ ] **Step 2: Keep high contrast hero text**

Leave the landing hero title white because it sits on a blue gradient.

- [ ] **Step 3: Verify and commit**

Run lint/build and commit:

```bash
git add components/layout/navbar.tsx app/login/login-form.tsx
git commit -m "KAN-19 normalize logo wordmark color"
```

---

### Task 3: Dashboard validated match/win counts

**Files:**
- Create: `lib/tournament/player-stats.ts`
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Extract pure helpers**

Create `isUserInMatchSide(match, userId, side)` and `computeValidatedPlayerStats(matches, userId)` supporting `player_a1/a2`, `player_b1/b2`, and `team_a/team_b.team_members`.

- [ ] **Step 2: Fetch richer match rows**

Dashboard match query should select validated matches with teams and team members, then filter in TypeScript with the helper.

- [ ] **Step 3: Use only validated matches**

Stats cards should display validated participating match count and wins.

- [ ] **Step 4: Verify and commit**

Run lint/build and commit:

```bash
git add lib/tournament/player-stats.ts app/(app)/dashboard/page.tsx
git commit -m "KAN-20 fix dashboard validated match stats"
```

---

### Task 4: Bracket generation UX and ordering

**Files:**
- Modify: `components/tournament/admin-generate-round.tsx`

- [ ] **Step 1: Always show View Tournament when schedule/bracket exists**

Add a `Link` button to `/tournaments/${tournament.id}` in the existing-schedule card.

- [ ] **Step 2: Allow Top 4/Top 8 choice**

When RR is validated and bracket is not generated, show buttons for valid advancement counts from `[4, 8]`, limited by `standings.length` / `entityCount`. On click, generate bracket with that count and update `tournaments.advancement_count`.

- [ ] **Step 3: Fix round ordering**

Remove `reversedRounds`; insert `bracketRounds` in returned order so elimination rounds are followed by bronze then final.

- [ ] **Step 4: Verify and commit**

Run lint/build and commit:

```bash
git add components/tournament/admin-generate-round.tsx
git commit -m "KAN-21 KAN-22 improve bracket generation"
```

---

### Task 5: Doubles standings names

**Files:**
- Modify: `app/(app)/tournaments/[id]/leaderboard/page.tsx`

- [ ] **Step 1: Display members only**

For doubles team standings, set entity name from members only: `Player A / Player B`. Ignore custom team name.

- [ ] **Step 2: Verify and commit**

Run lint/build and commit:

```bash
git add app/(app)/tournaments/[id]/leaderboard/page.tsx
git commit -m "KAN-23 show doubles standings player names"
```

---

### Task 6: Sticky tournament bottom navigation

**Files:**
- Create: `components/tournament/tournament-bottom-nav.tsx`
- Modify: `app/(app)/tournaments/[id]/page.tsx`
- Modify: `app/(app)/tournaments/[id]/admin/page.tsx`
- Modify: `app/(app)/tournaments/[id]/leaderboard/page.tsx`
- Modify: `app/(app)/tournaments/[id]/matches/page.tsx`

- [ ] **Step 1: Create client nav component**

Render fixed bottom nav with Overview, Matches, Standings, and Admin when `isAdmin` is true. Highlight current path via `usePathname()`.

- [ ] **Step 2: Add nav to tournament pages**

Pass `tournamentId` and `isAdmin` from each server page. Fetch admin row where needed.

- [ ] **Step 3: Avoid overlap**

Add bottom padding to page content when the tournament nav appears.

- [ ] **Step 4: Verify and commit**

Run lint/build and commit:

```bash
git add components/tournament/tournament-bottom-nav.tsx app/(app)/tournaments/[id]/page.tsx app/(app)/tournaments/[id]/admin/page.tsx app/(app)/tournaments/[id]/leaderboard/page.tsx app/(app)/tournaments/[id]/matches/page.tsx
git commit -m "KAN-24 add tournament sticky navigation"
```

---

## Final verification

- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Push branch `kan-9-next-changes`.
- [ ] Open PR for ED testing.
- [ ] Create a Jira testing task for ED with preview URL and test steps if Vercel preview is available.
