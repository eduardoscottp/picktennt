"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { buildBracket } from "@/lib/tournament/bracket";
import { computeStandings } from "@/lib/tournament/standings";
import { Trophy } from "lucide-react";
import type { Tournament, Match } from "@/types/database";

interface Props {
  tournament: Tournament;
  matches: Match[];
  advancingCount: number; // must be power of 2
}

function isPowerOfTwo(n: number) { return n >= 2 && (n & (n - 1)) === 0; }

export function AdminBracketActions({ tournament, matches, advancingCount }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  if (!isPowerOfTwo(advancingCount)) return null;

  const rrMatches = matches.filter((m) => !m.bracket_next_winner_match_id && m.score_a == null
    ? false  // unplayed RR match — still pending
    : true
  );
  const allRRValidated = matches
    .filter((m) => !m.bracket_next_winner_match_id && m.bracket_winner_fills_side === null)
    .every((m) => m.status === "validated");

  const hasBracket = matches.some(
    (m) => m.bracket_next_winner_match_id !== null ||
      ["finals_gold", "finals_bronze"].some(() => false) // detected via round_type below
  );

  async function generateBracket() {
    setLoading(true);
    try {
      const supabase = createClient();

      // Compute standings from all RR matches
      const isMixed = tournament.type === "mixed";
      const standings = computeStandings(matches, isMixed ? "player" : "team");
      const topIds = standings.slice(0, advancingCount).map((s) => s.id);

      if (topIds.length < advancingCount) {
        throw new Error(`Not enough standings — need ${advancingCount} teams, got ${topIds.length}.`);
      }

      const bracketRounds = buildBracket(topIds);

      // Insert rounds in reverse order so referenced matches exist before referencing matches
      const reversedRounds = [...bracketRounds].reverse();

      // Map tempId → real DB id
      const idMap = new Map<string, string>();

      // First pass: insert all matches with null bracket links to get real IDs
      for (const round of reversedRounds) {
        // Get the last real round number
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

      // Second pass: wire up bracket progression links
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
            const { error } = await supabase.from("matches").update(update).eq("id", realId);
            if (error) throw error;
          }
        }
      }

      const label = advancingCount === 2 ? "Final" : advancingCount === 4 ? "Semifinals + Final" : `Top-${advancingCount} bracket`;
      toast(`${label} generated!`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to generate bracket", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-brand-200 bg-brand-50/30">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-brand-500" />
          Bracket — Top {advancingCount}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-600">
          Round robin is complete. Generate the knockout bracket seeded by current standings.
        </p>
        <Button onClick={generateBracket} loading={loading} className="w-full">
          <Trophy className="h-4 w-4" />
          Generate Bracket
        </Button>
      </CardContent>
    </Card>
  );
}
