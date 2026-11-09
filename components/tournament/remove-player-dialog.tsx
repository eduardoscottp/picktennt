"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { removePlayerSimple, deleteAllRoundsAndRemovePlayer } from "@/lib/tournament/player-removal";

interface Props {
  tournamentPlayerId: string;
  tournamentId: string;
  playerName: string;
  path: "A" | "B" | "C";
  anyTournamentScores: boolean;
  gamesPlayed: number;
  inProgressMatchId: string | null;
}

/** Prestart roster removal only. Started tournaments use the Admin team withdrawal action. */
export function RemovePlayerDialog({ tournamentPlayerId, tournamentId, playerName, path, anyTournamentScores }: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const router = useRouter(), { toast } = useToast();
  if (path === "C" || anyTournamentScores) return null;
  async function remove() {
    setBusy(true);
    try {
      if (path === "B") await deleteAllRoundsAndRemovePlayer(tournamentPlayerId, tournamentId);
      else await removePlayerSimple(tournamentPlayerId);
      setOpen(false); router.refresh(); toast("Player removed.", "success");
    } catch (error) { toast(error instanceof Error ? error.message : "Could not remove player.", "error"); }
    finally { setBusy(false); }
  }
  return <><Button size="icon" variant="ghost" onClick={() => setOpen(true)} className="h-8 w-8 text-red-400" title={`Remove ${playerName}`}><UserMinus className="h-4 w-4" /></Button><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Remove {playerName}?</DialogTitle></DialogHeader><p className="text-sm text-gray-600">The player will leave this tournament. Their doubles position will remain available for another player.</p>{path === "B" && <p className="text-sm text-amber-800">The unplayed schedule will be removed. Generate a new schedule after updating the roster.</p>}<div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>Remove player</Button></div></DialogContent></Dialog></>;
}
