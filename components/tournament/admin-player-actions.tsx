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
