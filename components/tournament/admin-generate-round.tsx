"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { generateMixedSchedule } from "@/lib/tournament/mixed-pairing";
import { generateRoundRobinSchedule, roundsNeeded } from "@/lib/tournament/round-robin";
import { buildBracket } from "@/lib/tournament/bracket";
import { computeStandings } from "@/lib/tournament/standings";
import type { Tournament, Match } from "@/types/database";
import { CalendarRange, CheckCircle2, Trophy, AlertCircle } from "lucide-react";

interface TeamInfo {
  id: string;
  memberCount: number;
}

interface Props {
  tournament: Tournament;
  playerCount: number;
  teamsData?: TeamInfo[];
  hasExistingRounds: boolean;
  rrMatches: Match[];
  rrAllValidated: boolean;
  hasBracketAlready: boolean;
  advancingCount: number | null;
}

export function AdminGenerateRound({
  tournament,
  playerCount,
  teamsData,
  hasExistingRounds,
  rrMatches,
  rrAllValidated,
  hasBracketAlready,
  advancingCount,
}: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const isDoubles = tournament.type === "doubles";
  const isMixed = tournament.type === "mixed";
  const teamCount = teamsData ? teamsData.length : (isDoubles ? Math.floor(playerCount / 2) : playerCount);
  const entityCount = isDoubles ? teamCount : playerCount;
  const incompleteTeams = isDoubles ? (teamsData ?? []).filter((t) => t.memberCount < 2) : [];
  const hasIncompleteTeams = incompleteTeams.length > 0;
  const notEnoughEntities = entityCount < 2;

  const totalRounds = entityCount < 2
    ? "?"
    : isMixed
    ? (tournament.games_per_player ?? "?")
    : roundsNeeded(
        entityCount,
        tournament.court_count,
        tournament.games_per_player ?? Math.max(1, entityCount - 1)
      );

  const pendingRRCount = rrMatches.filter((m) => m.status !== "validated").length;
  const advancementOptions = [4, 8].filter((count) => count <= entityCount);

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

      const ids = isMixed
        ? await fetchPlayerIds(supabase)
        : await fetchTeamIds(supabase);

      if (ids.length < 2) {
        throw new Error(
          `Need at least 2 ${isDoubles ? "complete teams" : "players"} to generate a schedule.`
        );
      }

      const schedule = isMixed
        ? buildMixedSchedule(ids)
        : buildSinglesSchedule(ids);

      if (schedule.length === 0) {
        throw new Error(
          "No rounds could be generated. Check that there are enough players and that games per player is set correctly."
        );
      }

      for (let i = 0; i < schedule.length; i++) {
        await insertRound(supabase, i + 1, schedule[i]);
      }

      // Auto-activate tournament if still in registration
      if (tournament.status === "registration") {
        await supabase
          .from("tournaments")
          .update({ status: "active" })
          .eq("id", tournament.id);
      }

      toast(`Round Robin generated — ${schedule.length} rounds!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to generate schedule", "error");
    } finally {
      setLoading(false);
    }
  }

  async function generateBracket(selectedAdvancingCount: number) {
    setLoading(true);
    try {
      const supabase = createClient();

      const { data: allMatchesRaw } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", tournament.id);
      const allMatches = (allMatchesRaw ?? []) as Match[];

      const standings = computeStandings(allMatches, isMixed ? "player" : "team");
      const topIds = standings.slice(0, selectedAdvancingCount).map((s) => s.id);

      if (topIds.length < selectedAdvancingCount) {
        throw new Error(
          `Not enough standings — need ${selectedAdvancingCount}, got ${topIds.length}.`
        );
      }

      const bracketRounds = buildBracket(topIds);
      const idMap = new Map<string, string>();

      for (const round of bracketRounds) {
        const { data: lastRound } = await supabase
          .from("rounds")
          .select("round_number")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: false })
          .limit(1);
        const nextRoundNum = ((lastRound?.[0]?.round_number) ?? 0) + 1;

        const { data: roundRow, error: roundErr } = await supabase
          .from("rounds")
          .insert({
            tournament_id: tournament.id,
            round_number: nextRoundNum,
            round_type: round.roundType,
            status: "active",
          })
          .select()
          .single();
        if (roundErr) throw roundErr;

        for (const m of round.matches) {
          const matchInsert: any = {
            tournament_id: tournament.id,
            round_id: roundRow.id,
            court_number: m.court,
            status: "scheduled",
          };
          if (isMixed) {
            matchInsert.player_a1_id = m.teamAId;
            matchInsert.player_b1_id = m.teamBId;
          } else {
            matchInsert.team_a_id = m.teamAId;
            matchInsert.team_b_id = m.teamBId;
          }

          const { data: matchRow, error: matchErr } = await supabase
            .from("matches")
            .insert(matchInsert)
            .select()
            .single();
          if (matchErr) throw matchErr;

          idMap.set(m.tempId, matchRow.id);
        }
      }

      for (const round of bracketRounds) {
        for (const m of round.matches) {
          const realId = idMap.get(m.tempId);
          if (!realId) continue;
          const update: any = {};
          if (m.nextWinnerTempId) {
            update.bracket_next_winner_match_id = idMap.get(m.nextWinnerTempId) ?? null;
            update.bracket_winner_fills_side = m.winnerFillsSide;
          }
          if (m.nextLoserTempId) {
            update.bracket_next_loser_match_id = idMap.get(m.nextLoserTempId) ?? null;
            update.bracket_loser_fills_side = m.loserFillsSide;
          }
          if (Object.keys(update).length > 0) {
            await supabase.from("matches").update(update).eq("id", realId);
          }
        }
      }

      await supabase
        .from("tournaments")
        .update({ advancement_count: selectedAdvancingCount })
        .eq("id", tournament.id);

      const label =
        selectedAdvancingCount === 2
          ? "Final"
          : selectedAdvancingCount === 4
          ? "Semifinals + Final"
          : `Top-${selectedAdvancingCount} bracket`;
      toast(`${label} generated!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to generate bracket", "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Schedule already exists ────────────────────────────────────────────────
  if (hasExistingRounds) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-brand-500" />
            Tournament Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Round Robin status */}
          <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-200 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900">Round Robin schedule generated</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {isDoubles ? `${teamCount} teams` : `${playerCount} players`} · {totalRounds} rounds
              </p>
            </div>
          </div>

          <Link href={`/tournaments/${tournament.id}`}>
            <Button variant="outline" className="w-full">
              View Tournament
            </Button>
          </Link>

          {/* Bracket phase */}
          {advancementOptions.length > 0 && (
            <div className="border-t pt-3 space-y-2.5">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-brand-500" />
                Knockout Bracket{advancingCount ? ` — Top ${advancingCount}` : ""}
              </p>

              {hasBracketAlready ? (
                <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-green-700 font-medium">Bracket generated</span>
                </div>
              ) : !rrAllValidated ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold">
                      {pendingRRCount} match{pendingRRCount !== 1 ? "es" : ""} still need{pendingRRCount === 1 ? "s" : ""} scores.
                    </span>{" "}
                    Enter all round robin results before generating the bracket.
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {advancementOptions.map((count) => (
                    <Button key={count} onClick={() => generateBracket(count)} loading={loading} className="w-full">
                      <Trophy className="h-4 w-4" />
                      Generate Top {count}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── No schedule yet ────────────────────────────────────────────────────────
  const canGenerate = !notEnoughEntities && !hasIncompleteTeams;

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
            ? `${teamCount} teams · ${playerCount} players`
            : `${playerCount} ${isMixed ? "players" : "players"}`}{" "}
          · {tournament.court_count} courts · {totalRounds} rounds
        </p>

        {notEnoughEntities && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 font-medium flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            Need at least 2 {isDoubles ? "complete teams" : "players"} to generate a schedule.
          </div>
        )}

        {hasIncompleteTeams && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 font-medium flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {incompleteTeams.length} team{incompleteTeams.length > 1 ? "s are" : " is"} missing a partner.
            All teams must have 2 players before generating.
          </div>
        )}

        <Button
          onClick={generateSchedule}
          loading={loading}
          disabled={!canGenerate}
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
