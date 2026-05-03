"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ShieldCheck, Pencil } from "lucide-react";
import type { Match } from "@/types/database";

interface Props {
  match: Match & { team_a?: any; team_b?: any; player_a1?: any; player_a2?: any; player_b1?: any; player_b2?: any };
  userId: string;
  isAdmin: boolean;
  isMixed: boolean;
}

function playerName(p: any): string {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ");
}

function sideLabel(match: Props["match"], side: "a" | "b", isMixed: boolean): string {
  if (isMixed) {
    const p1 = side === "a" ? match.player_a1 : match.player_b1;
    const p2 = side === "a" ? match.player_a2 : match.player_b2;
    return [playerName(p1), playerName(p2)].filter(Boolean).join(" & ") || (side === "a" ? "Side A" : "Side B");
  }
  const team = side === "a" ? match.team_a : match.team_b;
  const members: any[] = team?.team_members ?? [];
  return members.map((m: any) => playerName(m.profile)).filter(Boolean).join(" & ")
    || team?.name
    || (side === "a" ? "Team A" : "Team B");
}

export function ScoreEntryButton({ match, userId, isAdmin, isMixed }: Props) {
  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState(String(match.score_a ?? ""));
  const [scoreB, setScoreB] = useState(String(match.score_b ?? ""));
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const labelA = sideLabel(match, "a", isMixed);
  const labelB = sideLabel(match, "b", isMixed);

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

  const canEnter    = isAdmin || isParticipant;
  const canValidate = isAdmin || (isOpposingTeam && match.status === "score_entered");

  function openDialog() {
    setScoreA(String(match.score_a ?? ""));
    setScoreB(String(match.score_b ?? ""));
    setOpen(true);
  }

  async function submitScore() {
    if (!scoreA || !scoreB) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const sa = parseInt(scoreA);
      const sb = parseInt(scoreB);
      const update: Record<string, any> = {
        score_a: sa, score_b: sb, entered_by: userId,
      };
      if (isAdmin) {
        update.status = "validated";
        update.validated_by = userId;
      } else {
        update.status = "score_entered";
      }
      const { error } = await supabase.from("matches").update(update).eq("id", match.id);
      if (error) throw error;

      // Auto-advance bracket when admin validates a bracket match
      if (isAdmin && update.status === "validated") {
        await advanceBracket(supabase, sa, sb);
      }

      toast(isAdmin ? "Score saved and validated." : "Score submitted! Waiting for validation.", "success");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to submit score", "error");
    } finally {
      setLoading(false);
    }
  }

  async function advanceBracket(supabase: any, sa: number, sb: number) {
    const winnerTeamId = sa > sb ? match.team_a_id : match.team_b_id;
    const loserTeamId  = sa > sb ? match.team_b_id : match.team_a_id;
    const winnerP1 = sa > sb ? match.player_a1_id : match.player_b1_id;
    const loserP1  = sa > sb ? match.player_b1_id : match.player_a1_id;

    if (match.bracket_next_winner_match_id && match.bracket_winner_fills_side) {
      const side = match.bracket_winner_fills_side;
      const field = isMixed
        ? (side === "a" ? "player_a1_id" : "player_b1_id")
        : (side === "a" ? "team_a_id" : "team_b_id");
      const value = isMixed ? winnerP1 : winnerTeamId;
      await supabase.from("matches").update({ [field]: value })
        .eq("id", match.bracket_next_winner_match_id);
    }

    if (match.bracket_next_loser_match_id && match.bracket_loser_fills_side) {
      const side = match.bracket_loser_fills_side;
      const field = isMixed
        ? (side === "a" ? "player_a1_id" : "player_b1_id")
        : (side === "a" ? "team_a_id" : "team_b_id");
      const value = isMixed ? loserP1 : loserTeamId;
      await supabase.from("matches").update({ [field]: value })
        .eq("id", match.bracket_next_loser_match_id);
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
      await advanceBracket(supabase, match.score_a ?? 0, match.score_b ?? 0);
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
      const { error } = await supabase.from("matches").update({ status: "disputed" }).eq("id", match.id);
      if (error) throw error;
      toast("Match marked as disputed. Admin will review.", "info");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  if (match.status === "validated") {
    if (!isAdmin) return null;
    return (
      <div className="mt-2">
        <button
          onClick={openDialog}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-500 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          Edit score
        </button>
        <ScoreDialog
          open={open} onOpenChange={setOpen}
          scoreA={scoreA} scoreB={scoreB}
          setScoreA={setScoreA} setScoreB={setScoreB}
          labelA={labelA} labelB={labelB}
          onSubmit={submitScore} loading={loading}
          isAdmin={isAdmin} title="Edit & Attest Score"
        />
      </div>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      {match.status === "score_entered" && canValidate && (
        <>
          <Button size="sm" onClick={validate} loading={loading} className="flex-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Validate
          </Button>
          <Button size="sm" variant="danger" onClick={dispute} loading={loading}>
            Dispute
          </Button>
        </>
      )}

      {(match.status === "scheduled" || match.status === "in_progress" || match.status === "disputed") && canEnter && (
        <Button size="sm" variant="outline" onClick={openDialog} className="flex-1">
          {match.status === "disputed" ? "Re-enter Score" : isAdmin ? "Enter & Attest" : "Enter Score"}
        </Button>
      )}

      <ScoreDialog
        open={open} onOpenChange={setOpen}
        scoreA={scoreA} scoreB={scoreB}
        setScoreA={setScoreA} setScoreB={setScoreB}
        labelA={labelA} labelB={labelB}
        onSubmit={submitScore} loading={loading}
        isAdmin={isAdmin}
        title={match.status === "disputed" ? "Re-enter Score" : isAdmin ? "Enter & Attest Score" : "Enter Match Score"}
      />
    </div>
  );
}

function ScoreDialog({
  open, onOpenChange, scoreA, scoreB, setScoreA, setScoreB, labelA, labelB, onSubmit, loading, isAdmin, title,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  scoreA: string; scoreB: string;
  setScoreA: (v: string) => void; setScoreB: (v: string) => void;
  labelA: string; labelB: string;
  onSubmit: () => void; loading: boolean; isAdmin: boolean; title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <Input
                label={labelA}
                type="number" min={0}
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
              />
            </div>
            <div className="text-2xl font-black text-gray-300 mt-6">:</div>
            <div className="flex-1 min-w-0">
              <Input
                label={labelB}
                type="number" min={0}
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
              />
            </div>
          </div>
          {isAdmin ? (
            <p className="text-xs text-brand-600 bg-brand-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
              As admin, your submission is immediately validated.
            </p>
          ) : (
            <p className="text-xs text-gray-400">
              The opposing team or an admin must validate this score before it counts.
            </p>
          )}
          <Button onClick={onSubmit} loading={loading} className="w-full">
            {isAdmin ? "Save & Validate" : "Submit Score"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
