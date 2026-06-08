# Player Removal, Withdrawal & Substitution Design

**Date:** 2026-06-08
**Project:** Picktennt
**Status:** Approved

---

## Overview

This spec covers all scenarios where a player needs to be removed, withdrawn, retired, or substituted from a tournament at any stage of its lifecycle. It also documents a bug fix for rejected players being included in match generation.

---

## 1. Database Migration

### `tournament_players` — two new columns

```sql
exit_reason TEXT CHECK (exit_reason IN ('withdrew', 'retired', 'disqualified')) DEFAULT NULL,
nullified_from_standings BOOLEAN NOT NULL DEFAULT FALSE
```

- `exit_reason`: records why the player left. NULL means still active.
- `nullified_from_standings`: when TRUE, all of this player's matches are excluded from pool standings calculations.

### `matches` — one new column

```sql
submit_to_dupr BOOLEAN NOT NULL DEFAULT TRUE
```

- Defaults to TRUE for all new matches.
- Set to FALSE explicitly on walkover/forfeit matches that should not be submitted to DUPR.

### `matches.status` — add `walkover` value

```sql
-- Extend check constraint to include 'walkover':
CHECK (status IN ('scheduled','in_progress','score_entered','validated','disputed','walkover'))
```

### Nullification rules reference table

| Scenario | `exit_reason` | `nullified_from_standings` | Future match `status` | Future `submit_to_dupr` |
|---|---|---|---|---|
| No-show (0 games, Path B option 2) | `disqualified` | `true` | `walkover` | `false` |
| Mid-RR withdrawal | `withdrew` | `true` | `walkover` | `false` |
| Post-RR withdrawal (before playoffs) | `withdrew` | `false` | `walkover` | `false` |
| Mid-game retirement (RR incomplete) | `retired` | `true` | `walkover` | `false` |
| Mid-game retirement (RR complete) | `retired` | `false` | `walkover` | `false` |
| Finals retirement | `retired` | `false` | N/A | N/A |

---

## 2. Bug Fix — Match Generation & Player Removal Cleanup

### Problem
When an admin removes a player (sets `status = 'rejected'`), the player still appears in the roster query used by `admin-generate-round.tsx`. Rejected players get included in generated rounds.

### Fix 1 — `admin-player-actions.tsx`
When removing an approved player, the action must:
1. Set `status = 'rejected'` on `tournament_players` (already done)
2. **Delete their `team_members` record** if they were assigned to a doubles team
3. **Delete the team** if removing this player leaves it empty

### Fix 2 — `admin-generate-round.tsx`
The player/team query used before generating rounds must strictly filter:
- Only players with `status = 'approved'`
- For doubles: only teams with exactly 2 members

---

## 3. Remove Player Flows

The admin clicks the Remove Player button. The system detects context and routes to the correct path automatically.

---

### Path A — Before any matches have been generated

**Condition:** No rounds/matches exist for this tournament.

**Flow:**
1. Show confirmation: *"Remove [Name] from the tournament? This cannot be undone."*
2. On confirm:
   - Delete `team_members` record (if doubles)
   - Delete team if now empty
   - Set `tournament_players.status = 'rejected'`

No exit_reason or nullification needed — clean removal.

---

### Path B — Matches generated, player has 0 games played

**Condition:** Rounds exist, but this player has no matches with `status` in (`score_entered`, `validated`, `disputed`, `in_progress`, `walkover`).

**Sub-condition A — No scores anywhere in the tournament:**

Show two options:
- **Regenerate schedule** — Delete all rounds and matches, remove the player, admin re-generates from scratch with updated roster.
- **Record as walkovers** — Keep the schedule. Mark all this player's matches as `walkover`, set `submit_to_dupr = false`. Set `exit_reason = 'disqualified'`, `nullified_from_standings = true` on their `tournament_players` record.

**Sub-condition B — At least one match anywhere has a score:**

Only show walkovers option:
> *"Other matches already have scores recorded. [Name]'s remaining matches will be recorded as walkovers."*

Apply same flags as Sub-condition A walkovers option.

**Substitution in Path B:**
- If admin wants to add a new player after removal, they use the existing Add Player flow.
- If Sub-condition B (scores exist), substitution is blocked entirely. Admin must use Path C instead.

---

### Path C — Player has 1 or more games played

**Condition:** Player has at least one match with `status` in (`score_entered`, `validated`).

**Step 1 — Dialog asks the reason:**
> *"Why is [Name] leaving the tournament?"*
> - Withdrawal (left voluntarily)
> - Retirement (stopped during an active match)

---

#### Path C1 — Withdrawal

System checks: did this player complete the full round robin?
- **RR incomplete:** Set `nullified_from_standings = true`
- **RR complete:** Set `nullified_from_standings = false`

In both cases:
- Set `exit_reason = 'withdrew'`
- All future `scheduled` matches for this player → `status = 'walkover'`, `submit_to_dupr = false`
- Already-scored matches are untouched (`submit_to_dupr` stays `true`)

---

#### Path C2 — Retirement (mid-game)

**Step 2 — Admin enters the retirement score:**
> *"[Name] retired during their match against [Opponent]. Enter the final score:"*
> `[ Player A score ] — [ Player B score ]`

Admin enters both scores manually (they know the adjustment rules). No auto-calculation.

System then:
- Updates the current in-progress match with the entered scores, sets `status = 'score_entered'`, `submit_to_dupr = true`
- All remaining future `scheduled` matches → `status = 'walkover'`, `submit_to_dupr = false`
- Set `exit_reason = 'retired'`
- `nullified_from_standings`: same logic as withdrawal — `true` if RR was incomplete, `false` if RR was complete

---

## 4. Bracket Re-Seeding After Withdrawal / Retirement

When a player is marked `withdrew` or `retired` and they had already qualified for the next round (playoffs or finals), the system must re-seed the bracket before it can be generated.

### Rules

1. The withdrawn/retired player is **dropped to last place** in the round robin standings.
2. Every player ranked below them **moves up one position**.
3. The next eligible player (who moved up) takes the vacated bracket slot.
4. The finals/next round **cannot be generated** until the entire round robin is fully complete (no active player has unplayed matches).

### Example

> Round robin ends. Top 4 qualify. Player ranked #3 withdraws.
>
> Before: 1, 2, **3**, 4, 5, 6
> After:  1, 2, 4, 5, 6, **3** (withdrawn, last)
>
> New top 4 to advance: players 1, 2, 4, 5

### Generation gate

The "Generate Finals/Next Round" button is blocked if:
- Any active player still has unplayed round robin matches, **OR**
- A withdrawal/retirement has been processed but bracket re-seeding has not been applied yet

---

## 5. DUPR Submission Summary

| Match type | `submit_to_dupr` |
|---|---|
| Normal completed match | `true` (default) |
| Walkover / forfeit | `false` |
| Retirement adjusted score | `true` |
| No-show 0-0 | `false` |

The DUPR export query filters `WHERE submit_to_dupr = true`.

---

## 6. Components Affected

| File | Change |
|---|---|
| `supabase/migrations/010_player_exit_fields.sql` | New migration with all schema changes |
| `components/tournament/admin-player-actions.tsx` | New flow logic: detect path A/B/C, show correct dialog |
| `components/tournament/admin-generate-round.tsx` | Fix player query to filter approved-only; add bracket gate for withdrawal |
| `app/(app)/tournaments/[id]/admin/page.tsx` | Pass game-count data to `AdminPlayerActions` |
| `lib/` | New server actions: `removePlayer`, `processWithdrawal`, `processRetirement`, `reseedBracket` |

---

## 7. Out of Scope

- Player-initiated withdrawal (only admin can process removals)
- Doubles team partial withdrawal (one partner leaves a doubles team) — separate spec needed
- Email/push notifications to affected players
