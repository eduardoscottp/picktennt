"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Match } from "@/types/database";

interface Props {
  match: Match & { team_a?: any; team_b?: any; player_a1?: any; player_a2?: any; player_b1?: any; player_b2?: any };
  userId: string;
  isAdmin: boolean;
  isMixed: boolean;
}

export function ScoreEntryButton({ match, userId, isAdmin, isMixed }: Props) {
  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState(String(match.score_a ?? ""));
  const [scoreB, setScoreB] = useState(String(match.score_b ?? ""));
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  // Determine if user is a participant in this match
  const playerIds = isMixed
    ? [match.player_a1_id, match.player_a2_id, match.player_b1_id, match.player_b2_id]
    : [
        ...(match.team_a?.team_members ?? []).map((m: any) => m.user_id),
        ...(match.team_b?.team_members ?? []).map((m: any) => m.user_id),
      ];
  const isParticipant = playerIds.includes(userId);
  const isOpposingTeam = isMixed
    ? [match.player_b1_id, match.player_b2_id].includes(userId)
    : (match.team_b?.team_members ?? []).some((m: any) => m.user_id === userId);

  const canEnter = isAdmin || isParticipant;
  const canValidate = isAdmin || (isOpposingTeam && match.status === "score_entered");

  async function submitScore() {
    if (!scoreA || !scoreB) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("matches")
        .update({
          score_a: parseInt(scoreA),
          score_b: parseInt(scoreB),
          status: "score_entered",
          entered_by: userId,
        })
        .eq("id", match.id);
      if (error) throw error;
      toast("Score submitted! Waiting for validation.", "success");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to submit score", "error");
    } finally {
      setLoading(false);
    }
  }

  async function validate() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("matches")
        .update({ status: "validated", validated_by: userId })
        .eq("id", match.id);
      if (error) throw error;
      toast("Score validated!", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to validate", "error");
    } finally {
      setLoading(false);
    }
  }

  async function dispute() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("matches")
        .update({ status: "disputed" })
        .eq("id", match.id);
      if (error) throw error;
      toast("Match marked as disputed. Admin will review.", "info");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  if (match.status === "validated") return null;

  return (
    <div className="mt-2 flex gap-2">
      {match.status === "score_entered" && canValidate && (
        <>
          <Button size="sm" onClick={validate} loading={loading} className="flex-1">
            Validate Score
          </Button>
          <Button size="sm" variant="danger" onClick={dispute} loading={loading}>
            Dispute
          </Button>
        </>
      )}

      {(match.status === "scheduled" || match.status === "in_progress" || match.status === "disputed") && canEnter && (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="flex-1">
          {match.status === "disputed" ? "Re-enter Score" : "Enter Score"}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Match Score</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Input
                  label="Team A Score"
                  type="number"
                  min={0}
                  value={scoreA}
                  onChange={(e) => setScoreA(e.target.value)}
                />
              </div>
              <div className="text-2xl font-black text-gray-300 mt-6">:</div>
              <div className="flex-1">
                <Input
                  label="Team B Score"
                  type="number"
                  min={0}
                  value={scoreB}
                  onChange={(e) => setScoreB(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              The opposing team or an admin must validate this score before it counts.
            </p>
            <Button onClick={submitScore} loading={loading} className="w-full">
              Submit Score
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
