"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandSnapshot } from "@/lib/tournament-builder/commands";
import { TeamWithdrawalDialog } from "@/components/tournament/team-withdrawal-dialog";

type Review = { preview_hash: string; event_revision: number; affected_match_ids?: string[]; blocking_code?: string; blocking_message?: string; message?: string };
export function TeamWithdrawal({ snapshot, disabled, label, run }: { snapshot: CommandSnapshot; disabled: boolean; label: (id: unknown) => string; run: (command: string, data: Record<string, unknown>) => Promise<void> }) {
  const event = snapshot.event!, [teamId, setTeamId] = useState(""), [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const proposal = { entry_id: teamId, reason: reason.trim(), policy: "all_matches_0_11" };
  async function preview() {
    setBusy(true); setError(""); setReview(null);
    try {
      const response = await fetch(`/api/tournament-builder/${event.id}/preview?kind=withdrawal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) });
      const result = await response.json() as Review;
      if (!response.ok || typeof result.preview_hash !== "string") throw new Error(result.message ?? "No se pudo revisar el retiro.");
      if (result.event_revision !== Number(event.revision)) throw new Error("El torneo cambió. Actualiza y revisa de nuevo.");
      if (result.blocking_code) throw new Error(result.blocking_message ?? result.message ?? "Resuelve los partidos afectados antes de retirar este equipo.");
      setReview(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo revisar el retiro."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    try { await run("withdrawEntry", { ...proposal, preview_hash: review.preview_hash, confirmed_forfeit: true }); setReview(null); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-lg font-bold">Retirar equipo</h2><p className="text-sm text-gray-600">El retiro cambia todos los partidos del equipo, incluidos los ya jugados, a derrota 0–11.</p><fieldset disabled={disabled || busy} className="space-y-3 disabled:opacity-60"><label className="block text-sm font-medium">Equipo a retirar<select aria-label="Equipo a retirar" className="mt-1 w-full rounded-lg border p-2" value={teamId} onChange={event => { setTeamId(event.target.value); setReview(null); }}><option value="">Selecciona un equipo</option>{snapshot.teams.filter(team => team.entry_state === "approved").map(team => <option key={team.id} value={team.id}>{label(team.id)}</option>)}</select></label><Input label="Motivo del retiro" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); setReview(null); }} /><Button variant="danger" loading={busy} disabled={!teamId || !reason.trim()} onClick={() => void preview()}>Retirar equipo</Button></fieldset>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<TeamWithdrawalDialog open={Boolean(review)} onOpenChange={open => { if (!open) setReview(null); }} teamName={label(teamId)} busy={busy || disabled} onConfirm={() => void confirm()}>{review && <p>{review.affected_match_ids?.length ?? 0} partidos registrados serán actualizados.</p>}</TeamWithdrawalDialog></section>;
}
