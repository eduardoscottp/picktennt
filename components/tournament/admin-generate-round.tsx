"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { generateMixedSchedule } from "@/lib/tournament/mixed-pairing";
import type { Tournament, RoundType } from "@/types/database";
import { Zap } from "lucide-react";

export function AdminGenerateRound({
  tournament,
  playerCount,
}: {
  tournament: Tournament;
  playerCount: number;
}) {
  const [roundType, setRoundType] = useState<RoundType>("round_robin");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function generateRound() {
    setLoading(true);
    try {
      const supabase = createClient();

      // Get current max round number
      const { data: existingRounds } = await supabase
        .from("rounds")
        .select("round_number")
        .eq("tournament_id", tournament.id)
        .order("round_number", { ascending: false })
        .limit(1);

      const nextRoundNumber = ((existingRounds?.[0]?.round_number) ?? 0) + 1;

      // Create round
      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .insert({
          tournament_id: tournament.id,
          round_number: nextRoundNumber,
          round_type: roundType,
          status: "active",
        })
        .select()
        .single();

      if (roundError) throw roundError;

      if (tournament.type === "mixed") {
        // Fetch approved players
        const { data: players } = await supabase
          .from("tournament_players")
          .select("user_id")
          .eq("tournament_id", tournament.id)
          .eq("status", "approved");

        const playerIds = (players ?? []).map((p: any) => p.user_id);
        const schedule = generateMixedSchedule(
          playerIds,
          tournament.court_count,
          tournament.games_per_player ?? 4
        );

        // Insert matches for the first unscheduled round
        const mixedRound = schedule[nextRoundNumber - 1] ?? schedule[0];
        if (mixedRound) {
          const matchInserts = mixedRound.matches.map((m) => ({
            tournament_id: tournament.id,
            round_id: round.id,
            court_number: m.court,
            player_a1_id: m.teamA[0],
            player_a2_id: m.teamA[1],
            player_b1_id: m.teamB[0],
            player_b2_id: m.teamB[1],
            status: "scheduled" as const,
          }));

          const { error: matchError } = await supabase.from("matches").insert(matchInserts);
          if (matchError) throw matchError;
        }
      } else {
        // Singles/Doubles: pair teams for this round
        const { data: teams } = await supabase
          .from("teams")
          .select("id")
          .eq("tournament_id", tournament.id);

        const allTeamIds = (teams ?? []).map((t: any) => t.id as string);
        const courts     = tournament.court_count;
        const maxMatches = Math.min(courts, Math.floor(allTeamIds.length / 2));

        // Find which teams sat out the PREVIOUS round — give them priority
        let satOutLastRound = new Set<string>();
        if (nextRoundNumber > 1) {
          const { data: prevRound } = await supabase
            .from("rounds")
            .select("id")
            .eq("tournament_id", tournament.id)
            .eq("round_number", nextRoundNumber - 1)
            .single();

          if (prevRound) {
            const { data: prevMatches } = await supabase
              .from("matches")
              .select("team_a_id, team_b_id")
              .eq("round_id", prevRound.id);

            const played = new Set(
              (prevMatches ?? []).flatMap((m: any) => [m.team_a_id, m.team_b_id])
            );
            allTeamIds.forEach((tid) => { if (!played.has(tid)) satOutLastRound.add(tid); });
          }
        }

        // Sort: teams that sat out last get priority, then shuffle the rest
        const priority = allTeamIds.filter((t) => satOutLastRound.has(t));
        const rest     = allTeamIds.filter((t) => !satOutLastRound.has(t)).sort(() => Math.random() - 0.5);
        const ordered  = [...priority, ...rest];

        // Pick the first maxMatches*2 teams to play; rest sit out
        const playing   = ordered.slice(0, maxMatches * 2);
        const matches: any[] = [];

        for (let i = 0; i < playing.length; i += 2) {
          matches.push({
            tournament_id: tournament.id,
            round_id: round.id,
            court_number: i / 2 + 1,
            team_a_id: playing[i],
            team_b_id: playing[i + 1],
            status: "scheduled" as const,
          });
        }

        if (matches.length > 0) {
          const { error: matchError } = await supabase.from("matches").insert(matches);
          if (matchError) throw matchError;
        }
      }

      toast(`Round ${nextRoundNumber} generated!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to generate round", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-brand-500" />
          Generate Next Round
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          {playerCount} approved players · {tournament.court_count} courts
          {tournament.type === "mixed" && ` · ${tournament.games_per_player} games each`}
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
        <Button onClick={generateRound} loading={loading} className="w-full">
          Generate Round
        </Button>
      </CardContent>
    </Card>
  );
}
