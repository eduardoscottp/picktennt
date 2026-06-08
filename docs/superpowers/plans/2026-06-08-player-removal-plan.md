# Player Removal, Withdrawal & Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complete player lifecycle management — safe removal before/during/after tournament play, with walkover recording, standings nullification, bracket re-seeding, and DUPR submission flags. Also fixes the bug where rejected players appear in generated rounds.

**Architecture:** A new server-action file (`lib/tournament/player-removal.ts`) holds all DB mutation logic. A new dialog component (`remove-player-dialog.tsx`) drives the multi-step UI for all three removal paths. The admin page (`admin/page.tsx`) pre-computes removal context (games played, any scores exist, nullified entity IDs) and passes it down as props so all routing decisions are data-driven.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (server client via `createClient`), Tailwind CSS, lucide-react, existing `Button` / `useToast` component patterns.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/010_player_exit_fields.sql` | **Create** | DB schema changes |
| `types/database.ts` | **Modify** | Add new types/fields |
| `lib/tournament/standings.ts` | **Modify** | Nullification filter |
| `app/api/tournaments/[id]/upload-dupr/route.ts` | **Modify** | DUPR submit_to_dupr filter |
| `app/api/tournaments/[id]/upload-dupr/preflight/route.ts` | **Modify** | Same DUPR filter |
| `lib/tournament/player-removal.ts` | **Create** | All removal server actions |
| `components/tournament/remove-player-dialog.tsx` | **Create** | Multi-step removal dialog |
| `components/tournament/admin-player-actions.tsx` | **Modify** | Replace button with dialog |
| `app/(app)/tournaments/[id]/admin/page.tsx` | **Modify** | Compute + pass removal context |
| `components/tournament/admin-generate-round.tsx` | **Modify** | Nullification in bracket, bracket gate |
| `app/(app)/tournaments/[id]/page.tsx` | **Modify** | Nullification in standings display |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/010_player_exit_fields.sql`

- [ ] **Step 1: Write migration file**

```sql
-- supabase/migrations/010_player_exit_fields.sql

-- tournament_players: track exit reason and standings nullification
ALTER TABLE tournament_players
  ADD COLUMN exit_reason TEXT CHECK (exit_reason IN ('withdrew', 'retired', 'disqualified')),
  ADD COLUMN nullified_from_standings BOOLEAN NOT NULL DEFAULT FALSE;

-- matches: DUPR submission flag (defaults true for all existing and future matches)
ALTER TABLE matches
  ADD COLUMN submit_to_dupr BOOLEAN NOT NULL DEFAULT TRUE;

-- matches: add 'walkover' to the status enum (drop old constraint, add new one)
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled','in_progress','score_entered','validated','disputed','walkover'));
```

- [ ] **Step 2: Apply migration via Supabase Management API**

Using PowerShell (replace `$PROJECT_REF` and `$SUPABASE_ACCESS_TOKEN` with values from `reference_picktennt_supabase.md` in memory):

```powershell
$sql = Get-Content "supabase/migrations/010_player_exit_fields.sql" -Raw
$body = @{ query = $sql } | ConvertTo-Json
Invoke-RestMethod `
  -Method POST `
  -Uri "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" `
  -Headers @{ Authorization = "Bearer $SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body $body
```

- [ ] **Step 3: Verify columns exist**

```powershell
$checkSql = "SELECT column_name FROM information_schema.columns WHERE table_name IN ('tournament_players','matches') AND column_name IN ('exit_reason','nullified_from_standings','submit_to_dupr') ORDER BY table_name, column_name;"
# Run same Invoke-RestMethod with $checkSql
# Expected: 3 rows returned
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/010_player_exit_fields.sql
git commit -m "feat: add exit_reason, nullified_from_standings, submit_to_dupr, walkover status"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Add `walkover` to MatchStatus**

Find this line:
```typescript
export type MatchStatus = "scheduled" | "in_progress" | "score_entered" | "validated" | "disputed";
```
Replace with:
```typescript
export type MatchStatus = "scheduled" | "in_progress" | "score_entered" | "validated" | "disputed" | "walkover";
```

- [ ] **Step 2: Add `exit_reason` and `nullified_from_standings` to the TournamentPlayer interface**

In the `TournamentPlayer` interface, add after the `status` field:
```typescript
  exit_reason: "withdrew" | "retired" | "disqualified" | null;
  nullified_from_standings: boolean;
```

- [ ] **Step 3: Add `submit_to_dupr` to the Match interface**

In the `Match` interface, add after the `status` field:
```typescript
  submit_to_dupr: boolean;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no new errors related to these fields.

- [ ] **Step 5: Commit**

```bash
git add types/database.ts
git commit -m "feat: extend MatchStatus, TournamentPlayer, and Match types for player exit"
```

---

## Task 3: Standings Nullification Filter

**Files:**
- Modify: `lib/tournament/standings.ts`

The goal: both `computeStandings` and `computeIndividualStandingsFromTeams` accept an optional `nullifiedEntityIds` set. Any match involving a nullified entity is excluded from standings calculations.

- [ ] **Step 1: Update `computeStandings` signature and filter**

Replace the function signature and the `validated` filter line:

```typescript
// Before:
export function computeStandings(
  matches: Match[],
  entityKey: "team" | "player"
): StandingRow[] {
  const validated = matches.filter((m) => m.status === "validated");

// After:
export function computeStandings(
  matches: Match[],
  entityKey: "team" | "player",
  nullifiedEntityIds?: Set<string>
): StandingRow[] {
  const validated = matches.filter((m) => {
    if (m.status !== "validated") return false;
    if (!nullifiedEntityIds?.size) return true;
    if (entityKey === "team") {
      if (m.team_a_id && nullifiedEntityIds.has(m.team_a_id)) return false;
      if (m.team_b_id && nullifiedEntityIds.has(m.team_b_id)) return false;
    } else {
      for (const id of [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id]) {
        if (id && nullifiedEntityIds.has(id)) return false;
      }
    }
    return true;
  });
```

- [ ] **Step 2: Update `computeIndividualStandingsFromTeams` signature and filter**

```typescript
// Before:
export function computeIndividualStandingsFromTeams(
  matches: Match[],
  teamToMembers: Map<string, string[]>
): StandingRow[] {
  const validated = matches.filter((m) => m.status === "validated");

// After:
export function computeIndividualStandingsFromTeams(
  matches: Match[],
  teamToMembers: Map<string, string[]>,
  nullifiedEntityIds?: Set<string>
): StandingRow[] {
  const validated = matches.filter((m) => {
    if (m.status !== "validated") return false;
    if (!nullifiedEntityIds?.size) return true;
    const membersA = teamToMembers.get(m.team_a_id ?? "") ?? [];
    const membersB = teamToMembers.get(m.team_b_id ?? "") ?? [];
    if (membersA.some((id) => nullifiedEntityIds.has(id))) return false;
    if (membersB.some((id) => nullifiedEntityIds.has(id))) return false;
    return true;
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors (new param is optional, all existing callers still work without it).

- [ ] **Step 4: Commit**

```bash
git add lib/tournament/standings.ts
git commit -m "feat: add nullifiedEntityIds filter to standings computation"
```

---

## Task 4: DUPR Submit Filter

**Files:**
- Modify: `app/api/tournaments/[id]/upload-dupr/route.ts`
- Modify: `app/api/tournaments/[id]/upload-dupr/preflight/route.ts`

- [ ] **Step 1: Update the matches query in `upload-dupr/route.ts`**

Find the query (currently):
```typescript
const { data: matchesRaw } = await admin
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .eq("status", "validated");
```
Replace with:
```typescript
const { data: matchesRaw } = await admin
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .eq("status", "validated")
    .eq("submit_to_dupr", true);
```

- [ ] **Step 2: Update the same query in `preflight/route.ts`**

Apply the identical `.eq("submit_to_dupr", true)` addition to whatever matches query exists in the preflight route.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/tournaments/[id]/upload-dupr/route.ts app/api/tournaments/[id]/upload-dupr/preflight/route.ts
git commit -m "feat: filter DUPR submission to only submit_to_dupr=true matches"
```

---

## Task 5: Player Removal Server Actions

**Files:**
- Create: `lib/tournament/player-removal.ts`

This file exports all server actions used by the dialog. All functions use the Supabase server client.

- [ ] **Step 1: Create `lib/tournament/player-removal.ts`**

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Get the team_id for a player in a specific tournament (singles/doubles only).
 * Returns null for mixed tournaments or if no team found.
 */
async function getPlayerTeamId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  tournamentId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("team_members")
    .select("team_id, teams!inner(tournament_id)")
    .eq("user_id", userId)
    .eq("teams.tournament_id", tournamentId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

/**
 * Build a Supabase .or() filter string for matches involving a player/team.
 */
function playerMatchFilter(isMixed: boolean, userId: string, teamId: string | null): string {
  if (isMixed) {
    return `player_a1_id.eq.${userId},player_a2_id.eq.${userId},player_b1_id.eq.${userId},player_b2_id.eq.${userId}`;
  }
  if (teamId) return `team_a_id.eq.${teamId},team_b_id.eq.${teamId}`;
  return "id.eq.00000000-0000-0000-0000-000000000000"; // match nothing
}

/**
 * Determine if a player completed the full round robin (no unplayed RR matches remaining).
 * Call this BEFORE marking matches as walkovers.
 */
async function hasCompletedRoundRobin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tournamentId: string,
  matchFilter: string
): Promise<boolean> {
  // Get all round_robin round IDs
  const { data: rrRounds } = await supabase
    .from("rounds")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("round_type", "round_robin");
  const rrRoundIds = new Set((rrRounds ?? []).map((r: any) => r.id));
  if (rrRoundIds.size === 0) return true;

  // Get all scheduled matches for this player
  const { data: scheduledMatches } = await supabase
    .from("matches")
    .select("id, round_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "scheduled")
    .or(matchFilter);

  const hasScheduledRR = (scheduledMatches ?? []).some((m: any) => rrRoundIds.has(m.round_id));
  return !hasScheduledRR; // completed RR = no scheduled RR matches remaining
}

// ─── Path A: Before any rounds ────────────────────────────────────────────────

/** Path A: Simple removal — no rounds exist yet. */
export async function removePlayerSimple(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("user_id, tournament_id")
    .eq("id", tournamentPlayerId)
    .single();
  if (!tp) throw new Error("Player record not found");

  // Clean up team membership
  const { data: tm } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", tp.user_id)
    .maybeSingle();

  if (tm?.team_id) {
    await supabase
      .from("team_members")
      .delete()
      .eq("user_id", tp.user_id)
      .eq("team_id", tm.team_id);

    const { count } = await supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", tm.team_id);

    if ((count ?? 0) === 0) {
      await supabase.from("teams").delete().eq("id", tm.team_id);
    }
  }

  await supabase
    .from("tournament_players")
    .update({ status: "rejected" })
    .eq("id", tournamentPlayerId);
}

// ─── Path B ───────────────────────────────────────────────────────────────────

/**
 * Path B option 1: Delete all rounds (cascades to matches), remove player,
 * reset tournament status to 'registration'.
 */
export async function deleteAllRoundsAndRemovePlayer(
  tournamentPlayerId: string,
  tournamentId: string
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("rounds").delete().eq("tournament_id", tournamentId);
  await supabase
    .from("tournaments")
    .update({ status: "registration" })
    .eq("id", tournamentId);
  await removePlayerSimple(tournamentPlayerId);
}

/**
 * Path B option 2: Keep schedule, mark all this player's matches as walkovers,
 * mark player as disqualified with nullified standings.
 */
export async function removePlayerWithWalkovers(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("user_id, tournament_id, tournaments!inner(type)")
    .eq("id", tournamentPlayerId)
    .single();
  if (!tp) throw new Error("Player record not found");

  const userId = tp.user_id;
  const tournamentId = tp.tournament_id;
  const isMixed = (tp as any).tournaments?.type === "mixed";
  const teamId = isMixed ? null : await getPlayerTeamId(supabase, userId, tournamentId);
  const matchFilter = playerMatchFilter(isMixed, userId, teamId);

  await supabase
    .from("matches")
    .update({ status: "walkover", submit_to_dupr: false })
    .eq("tournament_id", tournamentId)
    .eq("status", "scheduled")
    .or(matchFilter);

  await supabase
    .from("tournament_players")
    .update({
      status: "rejected",
      exit_reason: "disqualified",
      nullified_from_standings: true,
    })
    .eq("id", tournamentPlayerId);
}

// ─── Path C ───────────────────────────────────────────────────────────────────

/**
 * Path C1: Withdrawal — mark remaining scheduled matches as walkovers.
 * Nullifies standings if the player had unfinished RR matches.
 */
export async function processWithdrawal(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("user_id, tournament_id, tournaments!inner(type)")
    .eq("id", tournamentPlayerId)
    .single();
  if (!tp) throw new Error("Player record not found");

  const userId = tp.user_id;
  const tournamentId = tp.tournament_id;
  const isMixed = (tp as any).tournaments?.type === "mixed";
  const teamId = isMixed ? null : await getPlayerTeamId(supabase, userId, tournamentId);
  const matchFilter = playerMatchFilter(isMixed, userId, teamId);

  // Check RR completion BEFORE converting scheduled → walkover
  const rrComplete = await hasCompletedRoundRobin(supabase, tournamentId, matchFilter);

  // Mark remaining scheduled matches as walkovers
  await supabase
    .from("matches")
    .update({ status: "walkover", submit_to_dupr: false })
    .eq("tournament_id", tournamentId)
    .eq("status", "scheduled")
    .or(matchFilter);

  await supabase
    .from("tournament_players")
    .update({
      status: "rejected",
      exit_reason: "withdrew",
      nullified_from_standings: !rrComplete,
    })
    .eq("id", tournamentPlayerId);
}

/**
 * Path C2: Retirement — update the active match score (admin-entered),
 * then process like withdrawal for remaining games.
 * Pass retiredMatchId=null if player retired between games (not mid-game).
 */
export async function processRetirement(
  tournamentPlayerId: string,
  retiredMatchId: string | null,
  scoreA: number,
  scoreB: number
): Promise<void> {
  const supabase = await createClient();

  if (retiredMatchId) {
    await supabase
      .from("matches")
      .update({
        score_a: scoreA,
        score_b: scoreB,
        status: "score_entered",
        submit_to_dupr: true,
      })
      .eq("id", retiredMatchId);
  }

  // Process remaining future matches as withdrawal
  await processWithdrawal(tournamentPlayerId);

  // Override exit_reason to 'retired' (processWithdrawal sets it to 'withdrew')
  await supabase
    .from("tournament_players")
    .update({ exit_reason: "retired" })
    .eq("id", tournamentPlayerId);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/tournament/player-removal.ts
git commit -m "feat: add player removal server actions (paths A, B, C)"
```

---

## Task 6: Remove Player Dialog Component

**Files:**
- Create: `components/tournament/remove-player-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserMinus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  removePlayerSimple,
  removePlayerWithWalkovers,
  deleteAllRoundsAndRemovePlayer,
  processWithdrawal,
  processRetirement,
} from "@/lib/tournament/player-removal";

interface Props {
  tournamentPlayerId: string;
  tournamentId: string;
  playerName: string;
  /** A = no rounds; B = rounds exist, 0 games played; C = 1+ games played */
  path: "A" | "B" | "C";
  /** Path B: is any score recorded anywhere in this tournament? */
  anyTournamentScores: boolean;
  /** Path C: how many games has this player completed */
  gamesPlayed: number;
  /** Path C2: ID of the in-progress match, or null if retiring between games */
  inProgressMatchId: string | null;
}

type DialogStep = "closed" | "path-a" | "path-b" | "path-c-reason" | "path-c-score";

export function RemovePlayerDialog({
  tournamentPlayerId,
  tournamentId,
  playerName,
  path,
  anyTournamentScores,
  gamesPlayed,
  inProgressMatchId,
}: Props) {
  const [step, setStep] = useState<DialogStep>("closed");
  const [loading, setLoading] = useState(false);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const router = useRouter();
  const { toast } = useToast();

  function open() {
    setScoreA("");
    setScoreB("");
    if (path === "A") setStep("path-a");
    else if (path === "B") setStep("path-b");
    else setStep("path-c-reason");
  }

  function close() {
    setStep("closed");
    setLoading(false);
  }

  async function run(action: () => Promise<void>, successMsg: string) {
    setLoading(true);
    try {
      await action();
      toast(successMsg, "success");
      router.refresh();
      close();
    } catch (e: any) {
      toast(e.message ?? "Something went wrong", "error");
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger button */}
      <Button
        size="icon"
        variant="ghost"
        onClick={open}
        className="h-8 w-8 text-red-400"
        title={`Remove ${playerName}`}
      >
        <UserMinus className="h-4 w-4" />
      </Button>

      {/* Modal overlay */}
      {step !== "closed" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">

            {/* ── Path A: Simple confirmation ─────────────────────── */}
            {step === "path-a" && (
              <>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  <h2 className="text-base font-semibold text-gray-900">Remove {playerName}?</h2>
                </div>
                <p className="text-sm text-gray-500">
                  This removes them from the tournament. This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="ghost" onClick={close} disabled={loading}>Cancel</Button>
                  <Button
                    variant="danger"
                    loading={loading}
                    onClick={() => run(() => removePlayerSimple(tournamentPlayerId), "Player removed")}
                  >
                    Remove Player
                  </Button>
                </div>
              </>
            )}

            {/* ── Path B: 0 games played ──────────────────────────── */}
            {step === "path-b" && (
              <>
                <h2 className="text-base font-semibold text-gray-900">
                  {playerName} has no games played
                </h2>

                {anyTournamentScores ? (
                  /* Scores exist elsewhere — walkovers only */
                  <>
                    <p className="text-sm text-gray-500">
                      Other matches already have scores recorded.{" "}
                      {playerName}'s scheduled matches will be recorded as walkovers (0–0).
                    </p>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={close} disabled={loading}>Cancel</Button>
                      <Button
                        variant="danger"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => removePlayerWithWalkovers(tournamentPlayerId),
                            "Player removed, matches recorded as walkovers"
                          )
                        }
                      >
                        Remove & Record Walkovers
                      </Button>
                    </div>
                  </>
                ) : (
                  /* No scores yet — offer both options */
                  <>
                    <p className="text-sm text-gray-500">
                      How do you want to handle their scheduled matches?
                    </p>
                    <div className="flex flex-col gap-2 pt-1">
                      <Button
                        className="w-full justify-start text-left"
                        variant="ghost"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => deleteAllRoundsAndRemovePlayer(tournamentPlayerId, tournamentId),
                            "Schedule deleted — you can regenerate with the updated roster"
                          )
                        }
                      >
                        Regenerate schedule without this player
                      </Button>
                      <Button
                        className="w-full"
                        variant="danger"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => removePlayerWithWalkovers(tournamentPlayerId),
                            "Player removed, matches recorded as walkovers"
                          )
                        }
                      >
                        Record their matches as walkovers (0–0)
                      </Button>
                    </div>
                    <Button variant="ghost" onClick={close} disabled={loading} className="w-full">
                      Cancel
                    </Button>
                  </>
                )}
              </>
            )}

            {/* ── Path C: 1+ games played — choose reason ─────────── */}
            {step === "path-c-reason" && (
              <>
                <h2 className="text-base font-semibold text-gray-900">
                  Why is {playerName} leaving?
                </h2>
                <p className="text-sm text-gray-500">
                  They have played {gamesPlayed} game{gamesPlayed !== 1 ? "s" : ""}.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    className="w-full"
                    loading={loading}
                    onClick={() =>
                      run(() => processWithdrawal(tournamentPlayerId), "Player marked as withdrawn")
                    }
                  >
                    Withdrawal — left voluntarily
                  </Button>
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => setStep("path-c-score")}
                    disabled={loading}
                  >
                    Retirement — stopped during a match
                  </Button>
                </div>
                <Button variant="ghost" onClick={close} disabled={loading} className="w-full">
                  Cancel
                </Button>
              </>
            )}

            {/* ── Path C2: Retirement score entry ─────────────────── */}
            {step === "path-c-score" && (
              <>
                <h2 className="text-base font-semibold text-gray-900">
                  {playerName} retired mid-match
                </h2>
                {inProgressMatchId ? (
                  <>
                    <p className="text-sm text-gray-500">
                      Enter the final score at the time of retirement:
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">{playerName}</label>
                        <input
                          type="number"
                          min={0}
                          value={scoreA}
                          onChange={(e) => setScoreA(e.target.value)}
                          placeholder="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                      <span className="text-gray-400 font-semibold mt-4">–</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">Opponent</label>
                        <input
                          type="number"
                          min={0}
                          value={scoreB}
                          onChange={(e) => setScoreB(e.target.value)}
                          placeholder="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={() => setStep("path-c-reason")} disabled={loading}>
                        Back
                      </Button>
                      <Button
                        variant="danger"
                        loading={loading}
                        onClick={() => {
                          const a = parseInt(scoreA, 10);
                          const b = parseInt(scoreB, 10);
                          if (isNaN(a) || isNaN(b)) {
                            return;
                          }
                          run(
                            () => processRetirement(tournamentPlayerId, inProgressMatchId, a, b),
                            "Player marked as retired"
                          );
                        }}
                      >
                        Confirm Retirement
                      </Button>
                    </div>
                  </>
                ) : (
                  /* No in-progress match — retiring between games */
                  <>
                    <p className="text-sm text-gray-500">
                      No active match found. The player will be marked as retired and all remaining
                      scheduled matches recorded as walkovers.
                    </p>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={() => setStep("path-c-reason")} disabled={loading}>
                        Back
                      </Button>
                      <Button
                        variant="danger"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => processRetirement(tournamentPlayerId, null, 0, 0),
                            "Player marked as retired"
                          )
                        }
                      >
                        Confirm Retirement
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/tournament/remove-player-dialog.tsx
git commit -m "feat: add RemovePlayerDialog with path A/B/C flows"
```

---

## Task 7: Update AdminPlayerActions

**Files:**
- Modify: `components/tournament/admin-player-actions.tsx`

The approve/reject logic for pending players stays. For approved players, replace the raw `updateStatus("rejected")` button with `RemovePlayerDialog`.

- [ ] **Step 1: Replace the full file content**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Check, X } from "lucide-react";
import { RemovePlayerDialog } from "@/components/tournament/remove-player-dialog";

interface Props {
  tournamentPlayerId: string;
  tournamentId: string;
  playerName: string;
  status: "pending" | "approved";
  /** Removal context — only needed when status === "approved" */
  removalPath?: "A" | "B" | "C";
  anyTournamentScores?: boolean;
  gamesPlayed?: number;
  inProgressMatchId?: string | null;
}

export function AdminPlayerActions({
  tournamentPlayerId,
  tournamentId,
  playerName,
  status,
  removalPath = "A",
  anyTournamentScores = false,
  gamesPlayed = 0,
  inProgressMatchId = null,
}: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function approvePlayer() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("tournament_players")
        .update({ status: "approved" })
        .eq("id", tournamentPlayerId);
      if (error) throw error;
      toast("Player approved", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function rejectPlayer() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("tournament_players")
        .update({ status: "rejected" })
        .eq("id", tournamentPlayerId);
      if (error) throw error;
      toast("Player rejected", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // Pending player: approve / reject buttons (unchanged behaviour)
  if (status === "pending") {
    return (
      <div className="flex gap-1">
        <Button size="icon" onClick={approvePlayer} loading={loading} className="h-8 w-8">
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="danger"
          onClick={rejectPlayer}
          loading={loading}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Approved player: context-aware removal dialog
  return (
    <RemovePlayerDialog
      tournamentPlayerId={tournamentPlayerId}
      tournamentId={tournamentId}
      playerName={playerName}
      path={removalPath}
      anyTournamentScores={anyTournamentScores}
      gamesPlayed={gamesPlayed}
      inProgressMatchId={inProgressMatchId}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/tournament/admin-player-actions.tsx
git commit -m "feat: replace inline remove button with RemovePlayerDialog in AdminPlayerActions"
```

---

## Task 8: Admin Page — Compute and Pass Removal Context

**Files:**
- Modify: `app/(app)/tournaments/[id]/admin/page.tsx`

The admin page is a server component. We need to add three queries and pass the results to `AdminPlayerActions` for each approved player.

- [ ] **Step 1: Add queries for removal context**

In the admin page's data-fetching section (after existing queries), add:

```typescript
// ── Removal context ────────────────────────────────────────────────────────

// Does any match in this tournament have a score?
const { count: scoredMatchCount } = await supabase
  .from("matches")
  .select("id", { count: "exact", head: true })
  .eq("tournament_id", tournament.id)
  .in("status", ["score_entered", "validated", "in_progress"]);

const anyTournamentScores = (scoredMatchCount ?? 0) > 0;

// Has the schedule been generated?
const hasRounds = hasExistingRounds; // already computed above

// Games played per player — fetch ALL scored matches for this tournament once
const { data: scoredMatches } = await supabase
  .from("matches")
  .select("id, status, player_a1_id, player_a2_id, player_b1_id, player_b2_id, team_a_id, team_b_id")
  .eq("tournament_id", tournament.id)
  .in("status", ["score_entered", "validated", "in_progress"]);

// For doubles/singles: fetch team_members to map player → team
const { data: allTeamMembers } = await supabase
  .from("team_members")
  .select("user_id, team_id, teams!inner(tournament_id)")
  .eq("teams.tournament_id", tournament.id);

const playerToTeamId = new Map<string, string>();
for (const tm of allTeamMembers ?? []) {
  playerToTeamId.set((tm as any).user_id, (tm as any).team_id);
}

function gamesPlayedForPlayer(userId: string): number {
  const teamId = playerToTeamId.get(userId);
  return (scoredMatches ?? []).filter((m) => {
    // Mixed / singles direct player IDs
    if ([m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id].includes(userId)) return true;
    // Team-based
    if (teamId && (m.team_a_id === teamId || m.team_b_id === teamId)) return true;
    return false;
  }).length;
}

function inProgressMatchForPlayer(userId: string): string | null {
  const teamId = playerToTeamId.get(userId);
  const m = (scoredMatches ?? []).find(
    (m) =>
      m.status === "in_progress" &&
      (
        [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id].includes(userId) ||
        (teamId && (m.team_a_id === teamId || m.team_b_id === teamId))
      )
  );
  return m?.id ?? null;
}

function removalPath(userId: string): "A" | "B" | "C" {
  if (!hasRounds) return "A";
  if (gamesPlayedForPlayer(userId) > 0) return "C";
  return "B";
}
```

- [ ] **Step 2: Pass new props to `AdminPlayerActions` for approved players**

Find where approved players are rendered (look for `<AdminPlayerActions ... status="approved" />`). Update it to pass the new props:

```typescript
<AdminPlayerActions
  tournamentPlayerId={p.id}
  tournamentId={tournament.id}
  playerName={p.profiles?.full_name ?? p.profiles?.email ?? "Player"}
  status="approved"
  removalPath={removalPath(p.user_id)}
  anyTournamentScores={anyTournamentScores}
  gamesPlayed={gamesPlayedForPlayer(p.user_id)}
  inProgressMatchId={inProgressMatchForPlayer(p.user_id)}
/>
```

> **Note:** The exact field name for the player's display name may be `p.profiles?.full_name`, `p.profiles?.name`, or similar. Check the existing render code and match the pattern already used there.

- [ ] **Step 3: Compute nullifiedEntityIds for standings (needed in Task 9 + 10)**

Also add this to the data-fetching section for use by child components:

```typescript
// Players with nullified_from_standings = true (for standings calculation)
const nullifiedPlayers = (approvedPlayers ?? []).filter(
  (p: any) => p.nullified_from_standings === true
);
const nullifiedUserIds = new Set(nullifiedPlayers.map((p: any) => p.user_id as string));

// For team-based tournaments, resolve user IDs → team IDs
const nullifiedTeamIds = new Set<string>();
for (const userId of nullifiedUserIds) {
  const teamId = playerToTeamId.get(userId);
  if (teamId) nullifiedTeamIds.add(teamId);
}

// Pass to AdminGenerateRound as nullifiedEntityIds
const nullifiedEntityIds = tournament.type === "mixed"
  ? Array.from(nullifiedUserIds)
  : Array.from(nullifiedTeamIds);
```

Pass `nullifiedEntityIds={nullifiedEntityIds}` to `<AdminGenerateRound ... />`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/tournaments/[id]/admin/page.tsx"
git commit -m "feat: compute removal context and nullified entity IDs in admin page"
```

---

## Task 9: AdminGenerateRound — Nullification + Bracket Gate

**Files:**
- Modify: `components/tournament/admin-generate-round.tsx`

Two changes:
1. Accept `nullifiedEntityIds` prop and pass it to `computeStandings` inside `generateBracket`.
2. Block bracket generation if any active player has a pending withdrawal (exit_reason is set but has unresolved bracket matches — detected by checking for `walkover` matches in the tournament created after RR).

- [ ] **Step 1: Add `nullifiedEntityIds` to Props interface**

In the `Props` interface, add:
```typescript
  nullifiedEntityIds?: string[];
```

Add it to the destructured props in the function signature as well:
```typescript
  nullifiedEntityIds = [],
```

- [ ] **Step 2: Pass nullifiedEntityIds to `computeStandings` in `generateBracket`**

Find this code inside `generateBracket`:
```typescript
const standings = computeStandings(allMatches, isMixed ? "player" : "team");
```
Replace with:
```typescript
const standings = computeStandings(
  allMatches,
  isMixed ? "player" : "team",
  new Set(nullifiedEntityIds)
);
```

- [ ] **Step 3: Add bracket gate warning for active withdrawals**

The bracket is already blocked when `!rrAllValidated`. We also need to block it when `nullifiedEntityIds` has entries (a player was withdrawn during RR, meaning standings have changed and need to be acknowledged before generating the bracket).

Find the existing "pending RR matches" warning block:
```typescript
{!rrAllValidated ? (
  <div className="rounded-xl bg-amber-50 ...">
    ...pending matches warning...
  </div>
) : (
```
Change the condition to also check for active withdrawals:
```typescript
{!rrAllValidated || (nullifiedEntityIds.length > 0 && !hasBracketAlready) ? (
  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
    <span>
      {!rrAllValidated ? (
        <>
          <span className="font-semibold">
            {pendingRRCount} match{pendingRRCount !== 1 ? "es" : ""} still need{pendingRRCount === 1 ? "s" : ""} scores.
          </span>{" "}
          Enter all round robin results before generating the bracket.
        </>
      ) : (
        <>
          <span className="font-semibold">A player was withdrawn during the round robin.</span>{" "}
          Standings have been updated. Review before generating the bracket.
        </>
      )}
    </span>
  </div>
) : (
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add components/tournament/admin-generate-round.tsx
git commit -m "feat: pass nullifiedEntityIds to standings in bracket gen, add withdrawal gate"
```

---

## Task 10: Tournament Page — Nullification in Standings Display

**Files:**
- Modify: `app/(app)/tournaments/[id]/page.tsx`

The main tournament page displays standings. It calls `computeStandings` and `computeIndividualStandingsFromTeams`. Pass nullified entity IDs to both.

- [ ] **Step 1: Fetch nullified player IDs in the tournament page**

In the tournament page data-fetching section, add:

```typescript
// Nullified players (withdrawn/retired mid-RR) — excluded from standings
const { data: nullifiedTPs } = await supabase
  .from("tournament_players")
  .select("user_id")
  .eq("tournament_id", tournament.id)
  .eq("nullified_from_standings", true);

const nullifiedUserIds = new Set((nullifiedTPs ?? []).map((p: any) => p.user_id as string));

// For team-based: resolve user IDs → team IDs via team_members
let nullifiedTeamIds = new Set<string>();
if (tournament.type !== "mixed" && nullifiedUserIds.size > 0) {
  const { data: nullifiedTMs } = await supabase
    .from("team_members")
    .select("user_id, team_id")
    .in("user_id", Array.from(nullifiedUserIds));
  for (const tm of nullifiedTMs ?? []) {
    nullifiedTeamIds.add((tm as any).team_id);
  }
}

const nullifiedEntityIds = tournament.type === "mixed"
  ? nullifiedUserIds
  : nullifiedTeamIds;
```

- [ ] **Step 2: Pass `nullifiedEntityIds` to all `computeStandings` calls**

Find all calls to `computeStandings(...)` and `computeIndividualStandingsFromTeams(...)` in this file. Add `nullifiedEntityIds` as the third argument:

```typescript
// Before:
computeStandings(allMatches, isMixed ? "player" : "team")
// After:
computeStandings(allMatches, isMixed ? "player" : "team", nullifiedEntityIds)

// Before:
computeIndividualStandingsFromTeams(allMatches, teamToMembers)
// After:
computeIndividualStandingsFromTeams(allMatches, teamToMembers, nullifiedUserIds)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Build and verify no runtime errors**

```bash
npm run build
```
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/tournaments/[id]/page.tsx"
git commit -m "feat: apply standings nullification to tournament standings display"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| DB migration — 3 new fields + walkover status | Task 1 |
| TypeScript types updated | Task 2 |
| standings.ts nullification filter | Task 3 |
| DUPR filter submit_to_dupr | Task 4 |
| Path A: clean removal before rounds | Task 5 + 7 + 8 |
| Path B: 0 games — regenerate or walkovers | Task 5 + 6 + 8 |
| Path B: gate on any tournament scores | Task 6 + 8 |
| Path C1: withdrawal + nullification logic | Task 5 + 6 |
| Path C2: retirement + manual score entry | Task 5 + 6 |
| Bug fix: match gen only uses approved players | Task 3 of spec → `fetchPlayerIds` already filters `status = 'approved'` ✅ (already correct in the codebase) |
| Bug fix: remove player also cleans team_members | Task 5 (`removePlayerSimple`) |
| Bracket re-seeding via nullification | Tasks 3, 9, 10 — nullification causes withdrawn player to drop out of standings automatically |
| Bracket gate for active withdrawals | Task 9 |
| DUPR submission only for non-walkover matches | Task 4 |

**Placeholder scan:** None found.

**Type consistency:** `RemovePlayerDialog` props, `player-removal.ts` exports, and `AdminPlayerActions` props all use the same field names (`tournamentPlayerId`, `tournamentId`, `inProgressMatchId`). ✅

**One gap found and added:** The spec mentions the bug fix for `admin-generate-round.tsx` not filtering rejected players. Checking the actual `fetchPlayerIds` code confirms it already does `.eq("status", "approved")` — so the bug in the **query** is already fixed. The remaining bug is in `removePlayerSimple` not cleaning up `team_members`, which is fixed in Task 5.
