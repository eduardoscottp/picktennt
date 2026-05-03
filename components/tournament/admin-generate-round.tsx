"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { generateMixedSchedule } from "@/lib/tournament/mixed-pairing";
import { generateRoundRobinSchedule, roundsNeeded } from "@/lib/tournament/round-robin";
import type { Tournament, RoundType } from "@/types/database";
import { CalendarRange, ChevronRight } from "lucide-react";

export function AdminGenerateRound({
  tournament,
  playerCount,
}: {
  tournament: Tournament;
  playerCount: number;
}) {
  const [roundType, setRoundType] = useState<RoundType>("round_robin");
  const [loading, setLoading] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  // Fetch teams in a stable order so the circle method is deterministic
  async function fetchTeamIds(supabase: ReturnType<typeof createClient>) {
    const { data, error } = await supabase
      .from("teams")
      .select("id")
      .eq("tournament_id", tournament.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((t: any) => t.id as string);
  }

  async function fetchPlayerIds(supabase: ReturnType<typeof createClient>) {
    const { data, error } = await supabase
      .from("tournament_players")
      .select("user_id")
      .eq("tournament_id", tournament.id)
      .eq("status", "approved")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((p: any) => p.user_id as string);
  }

  async function deleteAllRounds(supabase: ReturnType<typeof createClient>) {
    // Cascade delete: deleting rounds auto-removes their matches via ON DELETE CASCADE
    const { error } = await supabase
      .from("rounds")
      .delete()
      .eq("tournament_id", tournament.id);
    if (error) throw error;
  }

  async function insertRound(
    supabase: ReturnType<typeof createClient>,
    roundNumber: number,
    matchInserts: any[]
  ) {
    const { data: round, error: roundError } = await supabase
      .from("rounds")
      .insert({
        tournament_id: tournament.id,
        round_number: roundNumber,
        round_type: roundType,
        status: "active",
      })
      .select()
      .single();
    if (roundError) throw roundError;

    if (matchInserts.length > 0) {
      const rows = matchInserts.map((m) => ({ ...m, round_id: round.id }));
      const { error: matchError } = await supabase.from("matches").insert(rows);
      if (matchError) throw matchError;
    }
  }

  // Build the full schedule (array of match-insert rows per round, without round_id)
  function buildSinglesSchedule(teamIds: string[]) {
    const gamesPerTeam = tournament.games_per_player ?? (teamIds.length - 1);
    const maxRounds = roundsNeeded(teamIds.length, tournament.court_count, gamesPerTeam);
    const full = generateRoundRobinSchedule(teamIds, tournament.court_count);
    return full.slice(0, maxRounds).map((pairs) =>
      pairs.map(([a, b], idx) => ({
        tournament_id: tournament.id,
        court_number: idx + 1,
        team_a_id: a,
        team_b_id: b,
        status: "scheduled" as const,
      }))
    );
  }

  function buildMixedSchedule(playerIds: string[]) {
    const gamesPerPlayer = tournament.games_per_player ?? 4;
    return generateMixedSchedule(playerIds, tournament.court_count, gamesPerPlayer).map((r) =>
      r.matches.map((m) => ({
        tournament_id: tournament.id,
        court_number: m.court,
        player_a1_id: m.teamA[0],
        player_a2_id: m.teamA[1],
        player_b1_id: m.teamB[0],
        player_b2_id: m.teamB[1],
        status: "scheduled" as const,
      }))
    );
  }

  async function generateFullSchedule() {
    setLoading(true);
    try {
      const supabase = createClient();
      await deleteAllRounds(supabase);

      const schedule =
        tournament.type === "mixed"
          ? buildMixedSchedule(await fetchPlayerIds(supabase))
          : buildSinglesSchedule(await fetchTeamIds(supabase));

      for (let i = 0; i < schedule.length; i++) {
        await insertRound(supabase, i + 1, schedule[i]);
      }

      toast(`${schedule.length} rounds generated!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to generate schedule", "error");
    } finally {
      setLoading(false);
    }
  }

  async function addNextRound() {
    setLoadingNext(true);
    try {
      const supabase = createClient();

      // Find next round number
      const { data: existing } = await supabase
        .from("rounds")
        .select("round_number")
        .eq("tournament_id", tournament.id)
        .order("round_number", { ascending: false })
        .limit(1);
      const nextRoundNumber = ((existing?.[0]?.round_number) ?? 0) + 1;

      // Use the same deterministic schedule — pick the next slot
      const schedule =
        tournament.type === "mixed"
          ? buildMixedSchedule(await fetchPlayerIds(supabase))
          : buildSinglesSchedule(await fetchTeamIds(supabase));

      const roundIndex = nextRoundNumber - 1;
      if (roundIndex >= schedule.length) {
        toast("All rounds have already been generated.", "info");
        return;
      }

      await insertRound(supabase, nextRoundNumber, schedule[roundIndex]);
      toast(`Round ${nextRoundNumber} added!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to add round", "error");
    } finally {
      setLoadingNext(false);
    }
  }

  const totalRounds =
    tournament.type === "mixed"
      ? (tournament.games_per_player ?? "?")
      : roundsNeeded(
          playerCount,
          tournament.court_count,
          tournament.games_per_player ?? Math.max(1, playerCount - 1)
        );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-brand-500" />
          Schedule Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          {playerCount} players · {tournament.court_count} courts · {totalRounds} rounds
        </p>

        <Select value={roundType} onValueChange={(v) => setRoundType(v as RoundType)}>
          <SelectTrigger label="Round Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="round_robin">Round Robin</SelectItem>
            <SelectItem value="par_match">Par Match</SelectItem>
            <SelectItem value="elimination">Elimination</SelectItem>
            <SelectItem value="finals_gold">Finals — Gold Match</SelectItem>
            <SelectItem value="finals_bronze">Finals — Bronze Match</SelectItem>
          </SelectContent>
        </Select>

        <Button
          onClick={generateFullSchedule}
          loading={loading}
          disabled={loadingNext}
          className="w-full"
        >
          <CalendarRange className="h-4 w-4" />
          Generate Full Schedule ({totalRounds} rounds)
        </Button>
        <p className="text-xs text-gray-400 -mt-1">
          Replaces any existing rounds. Every player faces each opponent exactly once.
        </p>

        <Button
          onClick={addNextRound}
          loading={loadingNext}
          disabled={loading}
          className="w-full"
          variant="secondary"
        >
          <ChevronRight className="h-4 w-4" />
          Add Next Round Only
        </Button>
      </CardContent>
    </Card>
  );
}
