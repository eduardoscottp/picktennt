# DUPR Score Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin button uploads validated tournament match scores to DUPR after tournament completes. Cannot upload unless every player has a DUPR ID stored in their profile.

**Architecture:** Reuse existing `profiles.dupr_id` column (already in migration 001). Rewrite `lib/dupr/client.ts` to use DUPR email/password auth (JWT) instead of unused API key. New admin-only API route under `app/api/tournaments/[id]/upload-dupr/` with preflight validation that lists missing-DUPR-ID players. Admin UI shows preflight result, blocks upload until all players have DUPR ID.

**Tech Stack:** Next.js 16 app router, React 19, Supabase SSR, TypeScript, Tailwind.

**Karpathy principles:** Think before coding · Simplicity first · Surgical changes · Goal-driven loops.

---

## File map

- Modify `lib/dupr/client.ts`: replace API-key stub with email/password login + token cache + match submission.
- Modify `components/auth/edit-profile-form.tsx`: add DUPR ID input field.
- Modify `app/(app)/profile/page.tsx`: render `dupr_id` next to `dupr_rating`.
- Create `app/api/tournaments/[id]/upload-dupr/preflight/route.ts`: GET, returns missing-DUPR-ID players.
- Create `app/api/tournaments/[id]/upload-dupr/route.ts`: POST, validates then submits all matches.
- Create `components/tournament/admin-upload-dupr.tsx`: client component, preflight + button + missing list.
- Modify `app/(app)/tournaments/[id]/admin/page.tsx`: mount upload component when status = completed.
- Modify `.env.local`: add DUPR_EMAIL, DUPR_PASSWORD, DUPR_GROUP_ID.

---

### Task 0: Run DB migration in Supabase

**Manual step (no code change).** Open Supabase dashboard → SQL Editor → run `supabase/migrations/001_initial_schema.sql` (and subsequent migrations 002–006). The `dupr_id TEXT` column on `profiles` ships with 001.

- [ ] **Step 1:** Confirm `profiles.dupr_id` column exists via `SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='dupr_id';`

---

### Task 1: Rewrite DUPR client

**Files:**
- Modify: `lib/dupr/client.ts`

- [ ] **Step 1:** Replace API-key bearer with email/password login → JWT cache → submit match.
- [ ] **Step 2:** Functions: `loginDupr()`, `submitDuprMatch({format, team1, team2, scores})`, `getClubMembers(clubId)`.
- [ ] **Step 3:** Read `DUPR_EMAIL`, `DUPR_PASSWORD`, `DUPR_API_BASE_URL` from env. Throw clear error if missing.
- [ ] **Step 4:** Token cached in module scope; refresh on 401.

---

### Task 2: Add DUPR ID to profile form

**Files:**
- Modify: `components/auth/edit-profile-form.tsx`
- Modify: `app/(app)/profile/page.tsx`

- [ ] **Step 1:** Add `dupr_id` input field (text, optional, placeholder "e.g. 67R4ND").
- [ ] **Step 2:** Persist to `profiles.dupr_id` on save.
- [ ] **Step 3:** Render DUPR ID under name in profile header.

---

### Task 3: Preflight route

**Files:**
- Create: `app/api/tournaments/[id]/upload-dupr/preflight/route.ts`

- [ ] **Step 1:** GET handler. Admin guard via `tournament_admins` table.
- [ ] **Step 2:** Collect distinct player IDs across all validated matches (singles + doubles + mixed all use same player_a1/a2/b1/b2 columns).
- [ ] **Step 3:** Query profiles where `dupr_id IS NULL OR dupr_id = ''`.
- [ ] **Step 4:** Return `{ ok, missing: Profile[], totalPlayers, validatedMatchCount }`.

---

### Task 4: Upload route with validation gate

**Files:**
- Create: `app/api/tournaments/[id]/upload-dupr/route.ts`

- [ ] **Step 1:** POST handler. Admin guard.
- [ ] **Step 2:** Reject if tournament.status != 'completed' → 409.
- [ ] **Step 3:** Run preflight inline. If any player missing DUPR ID → 409 with `{reason: "missing_dupr_ids", players}`. Atomic gate, no DUPR call attempted.
- [ ] **Step 4:** Login to DUPR once. For each validated match, POST match payload. Collect per-match results.
- [ ] **Step 5:** Return `{ submitted, failed, errors }`.

---

### Task 5: Admin UI component

**Files:**
- Create: `components/tournament/admin-upload-dupr.tsx`
- Modify: `app/(app)/tournaments/[id]/admin/page.tsx`

- [ ] **Step 1:** Client component. On mount, fetch preflight.
- [ ] **Step 2:** If missing list non-empty: disable button, show red card listing missing players (name + email).
- [ ] **Step 3:** If all set: green confirm "All N players have DUPR ID. Ready to upload."
- [ ] **Step 4:** On click → POST upload route → toast result.
- [ ] **Step 5:** In admin page, mount only when `tournament.status === 'completed'`.

---

### Task 6: Env vars

**Files:**
- Modify: `.env.local`

```
DUPR_EMAIL=eduardoscott@gmail.com
DUPR_PASSWORD=Picktennt.0912
DUPR_GROUP_ID=7006521965
```

- [ ] **Step 1:** Add 3 vars. Remove unused `DUPR_API_KEY`.

---

### Task 7: End-to-end test

- [ ] Run migration in Supabase.
- [ ] Set Eduardo's profile `dupr_id = '67R4ND'`.
- [ ] Find Victor Levia → set `dupr_id = '2QYZO4'`.
- [ ] Create singles tournament, 1v1, no finals.
- [ ] Add Victor + Eduardo, start.
- [ ] Score match: Eduardo 10, Victor 11 → validate.
- [ ] Mark tournament Completed.
- [ ] Click Upload to DUPR.
- [ ] Verify both DUPR profiles show the match.

---

## Final verification

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Manual E2E above passes.
