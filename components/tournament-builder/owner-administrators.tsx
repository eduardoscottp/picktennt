"use client";
import { useId, useState } from "react";
import type { StorageRow } from "@/lib/tournament-builder/commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Action = "addAdministrator" | "removeAdministrator";
type Target = { id: string; display_name: string };
type Preview = { tournament_id: string; event_revision: number; action: Action; data: { user_id: string; reason: string }; impact: { target_profile_id: string; permission_change: string; current_administrator_ids: string[]; owner_protected: boolean; does_not_transfer_ownership: boolean }; preview_hash: string };
export function OwnerAdministrators({ tournamentId, revision, ownerId, admins, disabled, run }: {
  tournamentId: string; revision: number; ownerId: string; admins: StorageRow[] | undefined; disabled: boolean;
  run: (command: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [action, setAction] = useState<Action>("addAdministrator");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ fingerprint: string; result: Preview } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  const fingerprint = JSON.stringify({ revision, action, user_id: target?.id, reason: reason.trim() });
  const current = review?.fingerprint === fingerprint && review.result.event_revision === revision ? review.result : null;
  function resetReview() { setReview(null); setConfirmed(false); setError(""); }
  async function lookup() {
    if (disabled || busy || !/^[a-z0-9_]{3,32}$/.test(normalized)) return;
    setBusy(true); resetReview(); setTarget(null);
    try {
      const response = await fetch("/api/tournament-builder/players/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: normalized }) });
      const result = await response.json();
      if (!response.ok || typeof result.id !== "string" || !UUID.test(result.id) || typeof result.display_name !== "string") throw new Error(result.message ?? "Could not find that Picktennt account.");
      if (result.id === ownerId || admins?.some(admin => admin.user_id === result.id)) throw new Error("This account already administers the tournament.");
      setAction("addAdministrator"); setTarget({ id: result.id, display_name: result.display_name });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Account lookup is unavailable."); }
    finally { setBusy(false); }
  }
  async function preview() {
    if (!target || !UUID.test(target.id) || !reason.trim() || reason.length > 1000 || disabled || busy) return;
    setBusy(true); resetReview();
    try {
      const response = await fetch(`/api/tournament-builder/${tournamentId}/owner-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: { user_id: target.id, reason: reason.trim() } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "This administrator change cannot be reviewed.");
      if (result.tournament_id !== tournamentId || result.event_revision !== revision || result.action !== action || result.data?.user_id !== target.id || result.data?.reason !== reason.trim() || !/^[a-f0-9]{64}$/.test(result.preview_hash) || result.impact?.target_profile_id !== target.id || result.impact?.owner_protected !== true || result.impact?.does_not_transfer_ownership !== true) throw new Error("Tournament access changed. Refresh and review this action again.");
      setReview({ fingerprint, result });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not review this administrator change."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border bg-white p-5" aria-label="Tournament administrator management"><h2 className="text-lg font-bold">Manage tournament administrators</h2>
    <p className="text-sm text-gray-600">Only the owner can grant or remove administrator access. This does not transfer ownership or register a player.</p>
    {!admins ? <p className="text-sm text-amber-800">Refresh the tournament to load its current administrators.</p> : <fieldset disabled={disabled || busy} className="space-y-4 disabled:opacity-60">
      <ul className="space-y-2">{[...admins].sort((a, b) => Number(a.succession_order) - Number(b.succession_order)).map(admin => <li key={admin.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><strong className="text-sm">{typeof admin.display_name === "string" ? admin.display_name : "Picktennt account"}</strong><p className="text-xs text-gray-500">{admin.user_id === ownerId ? "Owner · protected" : "Tournament administrator"}</p></div>{admin.user_id !== ownerId && typeof admin.user_id === "string" && <Button size="sm" variant="outline" onClick={() => { resetReview(); setAction("removeAdministrator"); setTarget({ id: String(admin.user_id), display_name: typeof admin.display_name === "string" ? admin.display_name : "Picktennt account" }); }}>Choose removal for {typeof admin.display_name === "string" ? admin.display_name : "account"}</Button>}</li>)}</ul>
      <Input id={`${id}-username`} label="New administrator’s Picktennt username" value={username} maxLength={33} onChange={event => { setUsername(event.target.value); setTarget(null); resetReview(); }} />
      <Button variant="outline" disabled={disabled || busy || !/^[a-z0-9_]{3,32}$/.test(normalized)} loading={busy} onClick={() => void lookup()}>Find administrator account</Button>
      {target && <p className="text-sm font-medium">{action === "addAdministrator" ? "Grant access to" : "Remove access from"}: {target.display_name}</p>}
      <Input id={`${id}-reason`} label="Reason for administrator change" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); resetReview(); }} />
      <Button variant="outline" disabled={disabled || busy || !target || !reason.trim()} onClick={() => void preview()}>Review administrator change</Button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {current && target && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm"><p>{current.action === "addAdministrator" ? "Grant tournament administrator permissions to" : "Remove tournament administrator permissions from"} <strong>{target.display_name}</strong>.</p><p>The owner remains protected. Player entries and match results are unchanged.</p><p className="text-gray-600">Reason: {current.data.reason}</p><label className="block"><input type="checkbox" className="mr-2" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed this administrator access change and want to proceed.</label><Button variant={current.action === "removeAdministrator" ? "danger" : "default"} disabled={disabled || busy || !confirmed} onClick={() => { if (current && confirmed) void run(current.action, { ...current.data, confirmed_owner_action: true, reviewed_action_hash: current.preview_hash }); }}>Confirm administrator change</Button></div>}
    </fieldset>}
  </section>;
}
