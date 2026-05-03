"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { generateMixedSchedule } from "@/lib/tournament/mixed-pairing";
import { generateRoundRobinSchedule, roundsNeeded } from "@/lib/tournament/round-robin";
import type { Tournament } from "@/types/database";
import { CalendarRange, CheckCircle2 } from "lucide-react";

interface TeamInfo {
  id: string;
  memberCount: number;
}

export function AdminGenerateRound({
  tournament,
  playerCount,
  teamsData,
  hasExistingRounds,
}: {
  tournament: Tournament;
  playerCount: number;
  teamsData?: TeamInfo[];
  hasExistingRounds: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const isDoubles = tournament.type === "doubles";
  const teamCount = teamsData ? teamsData.length : (isDoubles ? Math.floor(playerCount / 2) : playerCount);
  const entityCount = isDoubles ? teamCount : playerCount;
  const incompleteTeams = isDoubles ? (teamsData ?? []).filter((t) => t.memberCount < 2) : [];
  const hasIncompleteTeams = incompleteTeams.length > 0;

  const totalRounds =
    tournament.type === "mixed"
      ? (tournament.games_per_player ?? "?")
      : roundsNeeded(
          entityCount,
          tournament.court_count,
          tournament.games_per_player ?? Math.max(1, entityCount - 1)
        );

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
        round_type: "round_robin",
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

  async function generateSchedule() {
    setLoading(true);
    try {
      const supabase = createClient();

      const schedule =
        tournament.type === "mixed"
          ? buildMixedSchedule(await fetchPlayerIds(supabase))
          : buildSinglesSchedule(await fetchTeamIds(supabase));

      for (let i = 0; i < schedule.length; i++) {
        await insertRound(supabase, i + 1, schedule[i]);
      }

      toast(`Round Robin generated — ${schedule.length} rounds!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to generate schedule", "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Schedule already exists — read-only status ───────────────────────────
  if (hasExistingRounds) {
    return (
      <Card className="border-green-200 bg-green-50/40">
        <CardContent className="flex items-center gap-3 py-4 px-4">
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Round Robin schedule generated</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {isDoubles ? `${teamCount} teams` : `${playerCount} players`} · {totalRounds} rounds ·
              Scores must be entered to unlock the next phase
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── No schedule yet — show generate button ───────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-brand-500" />
          Round Robin Schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          {isDoubles
            ? `${teamCount} teams (${playerCount} players)`
            : `${playerCount} players`} · {tournament.court_count} courts · {totalRounds} rounds
        </p>

        {hasIncompleteTeams && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 font-medium">
            {incompleteTeams.length} team{incompleteTeams.length > 1 ? "s are" : " is"} missing a partner.
            All teams must have 2 players before the schedule can be generated.
          </div>
        )}

        <Button
          onClick={generateSchedule}
          loading={loading}
          disabled={hasIncompleteTeams}
          className="w-full"
        >
          <CalendarRange className="h-4 w-4" />
          Generate Round Robin ({totalRounds} rounds)
        </Button>
        <p className="text-xs text-gray-400 -mt-1">
          This can only be done once. Every {isDoubles ? "team" : "player"} will face each other exactly once.
        </p>
      </CardContent>
    </Card>
  );
}
