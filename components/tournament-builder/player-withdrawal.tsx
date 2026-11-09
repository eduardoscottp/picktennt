"use client";
import { useState } from "react";
import type { CommandSnapshot } from "@/lib/tournament-builder/commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Review = { preview_hash: string; event_revision: number; historical_match_ids: string[]; pending_match_ids: string[]; live_match_ids: string[]; unknown_history_match_ids: string[]; inconsistent_pending_match_ids: string[] };
export function PlayerWithdrawal({ snapshot, disabled, run }: { snapshot: CommandSnapshot; disabled: boolean; run: (command: string, data: Record<string, unknown>) => Promise<void> }) {
  const event = snapshot.event!, [selection, setSelection] = useState(""), [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [teamId, userId] = selection.split(":"), proposal = { team_id: teamId, user_id: userId, reason: reason.trim() };
  const members = snapshot.team_members.filter(member => member.membership_status === "active" && snapshot.teams.some(team => team.id === member.team_id && team.entry_state === "approved"));
  function reset() { setReview(null); setConfirmed(false); setError(""); }
  async function preview() {
    setBusy(true); reset();
    try {
      const response = await fetch(`/api/tournament-builder/${event.id}/preview?kind=player-withdrawal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) });
      const body = await response.json() as Review & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Could not review this withdrawal.");
      if (body.event_revision !== Number(event.revision)) throw new Error("The tournament changed. Refresh and review again.");
      setReview(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not review this withdrawal."); }
    finally { setBusy(false); }
  }
  const blocked = review && (review.live_match_ids.length > 0 || review.unknown_history_match_ids.length > 0 || review.inconsistent_pending_match_ids.length > 0);
  return <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-lg font-bold">Remove a player before starting</h2><p className="text-sm text-gray-600">The player position becomes vacant. Complete the roster before starting the tournament.</p><fieldset disabled={disabled || busy} className="space-y-4 disabled:opacity-60"><label className="block text-sm font-medium">Current player<select className="mt-1 w-full rounded-lg border border-gray-200 p-2" value={selection} onChange={event => { setSelection(event.target.value); reset(); }}><option value="">Choose a player</option>{members.map(member => <option key={member.id} value={`${member.team_id}:${member.user_id}`}>{typeof member.display_name === "string" ? member.display_name : "Player"} · {String(snapshot.teams.find(team => team.id === member.team_id)?.name ?? "Team")}</option>)}</select></label><Input label="Reason for withdrawal" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); reset(); }} /><Button variant="outline" disabled={!selection || !reason.trim()} onClick={() => void preview()}>Review player withdrawal</Button>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{review && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm"><p>{review.historical_match_ids.length} historical games retain their original players and results. The player will be removed from {review.pending_match_ids.length} pending games.</p>{blocked ? <p role="alert">Resolve {review.live_match_ids.length} live games, {review.unknown_history_match_ids.length} games with incomplete history and {review.inconsistent_pending_match_ids.length} pending games with inconsistent player identities before continuing.</p> : <><label className="block"><input type="checkbox" className="mr-2" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand this player will leave the team and the position will be vacant.</label><Button variant="danger" disabled={!confirmed} onClick={() => { const hash = review.preview_hash; setReview(null); void run("withdrawPlayer", { ...proposal, preview_hash: hash }); }}>Confirm player withdrawal</Button></>}</div>}</fieldset></section>;
}
