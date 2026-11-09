"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { forfeitLegacyTeam } from "@/lib/tournament/player-removal";
import { TeamWithdrawalDialog } from "./team-withdrawal-dialog";

export function LegacyTeamWithdrawal({ tournamentId, teams }: { tournamentId: string; teams: { id: string; name: string }[] }) {
  const [teamId, setTeamId] = useState(""), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const router = useRouter(), { toast } = useToast();
  const team = teams.find(item => item.id === teamId);
  async function confirm() {
    if (!team || busy) return;
    setBusy(true);
    try {
      await forfeitLegacyTeam(tournamentId, team.id);
      setOpen(false); setTeamId(""); router.refresh();
      toast("Equipo retirado. Todos sus partidos se registraron 0–11.", "success");
    } catch (error) { toast(error instanceof Error ? error.message : "No se pudo retirar el equipo.", "error"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5"><h2 className="text-lg font-bold">Retirar equipo</h2><p className="text-sm text-gray-600">El retiro cambia todos los partidos del equipo, incluidos los ya jugados, a derrota 0–11.</p><label className="block text-sm font-medium">Equipo a retirar<select aria-label="Equipo a retirar" className="mt-1 block w-full rounded-lg border p-2" value={teamId} disabled={busy} onChange={event => setTeamId(event.target.value)}><option value="">Selecciona un equipo</option>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Button variant="danger" disabled={!team || busy} onClick={() => setOpen(true)}>Retirar equipo</Button><TeamWithdrawalDialog open={open} onOpenChange={setOpen} teamName={team?.name ?? ""} busy={busy} onConfirm={() => void confirm()} /></section>;
}
