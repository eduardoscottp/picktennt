"use client";

import { useState } from "react";
import type { CommandSnapshot } from "@/lib/tournament-builder/commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerSearch } from "./player-search";

type Review = { preview_hash: string; event_revision: number; future_match_ids: string[]; preserved_match_ids: string[]; unknown_history_match_ids: string[]; blocked_future_match_ids: string[] };
export function PlayerReplacement({ snapshot, disabled, run, player }: { snapshot: CommandSnapshot; disabled: boolean; run: (command: string, data: Record<string, unknown>) => Promise<void>; player?: { teamId: string; userId: string } }) {
  const event = snapshot.event!;
  const [old, setOld] = useState(player ? `${player.teamId}:${player.userId}` : "");
  const [replacement, setReplacement] = useState<{ id: string; display_name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [teamId, oldUserId] = old.split(":");
  const entries = snapshot.team_members.filter(member => member.membership_status === "active" && snapshot.teams.some(team => team.id === member.team_id && team.entry_state === "approved"));
  function reset() { setReview(null); setConfirmed(false); setError(""); }
  const proposal = { team_id: teamId, old_user_id: oldUserId, new_user_id: replacement?.id, reason: reason.trim() };
  async function preview() {
    setBusy(true); reset();
    try {
      const response = await fetch(`/api/tournament-builder/${event.id}/preview?kind=player-replacement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) });
      const body = await response.json() as Review & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Could not review this replacement.");
      if (body.event_revision !== Number(event.revision)) throw new Error("The tournament changed. Refresh and review again.");
      setReview(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not review this replacement."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-lg font-bold">Replace a player</h2><p className="text-sm text-gray-600">The team and past scores remain. The replacement plays future matches.</p><fieldset disabled={disabled || busy} className="space-y-4 disabled:opacity-60">{!player && <label className="block text-sm font-medium">Current player<select className="mt-1 w-full rounded-lg border border-gray-200 p-2" value={old} onChange={event => { setOld(event.target.value); reset(); }}><option value="">Choose a player</option>{entries.map(member => <option key={member.id} value={`${member.team_id}:${member.user_id}`}>{typeof member.display_name === "string" ? member.display_name : "Player"} · {String(snapshot.teams.find(team => team.id === member.team_id)?.name ?? "Team")}</option>)}</select></label>}<PlayerSearch tournamentId={event.id} onQueryChange={() => { setReplacement(null); reset(); }} onSelect={player => { setReplacement(player); reset(); }} />{replacement && <p className="text-sm font-medium">Replacement: {replacement.display_name}</p>}<Input id={`replacement-reason-${teamId}-${oldUserId}`} label="Reason for replacement" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); reset(); }} /><Button variant="outline" disabled={!old || !replacement || !reason.trim()} onClick={() => void preview()}>Review replacement</Button>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{review && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm"><p>{review.preserved_match_ids.length} past or in-progress games keep their original players and results. {review.future_match_ids.length} scheduled games use the replacement.</p>{review.unknown_history_match_ids.length > 0 || review.blocked_future_match_ids.length > 0 ? <p role="alert">{review.unknown_history_match_ids.length > 0 && `${review.unknown_history_match_ids.length} past games have incomplete player history. `}{review.blocked_future_match_ids.length > 0 && `${review.blocked_future_match_ids.length} scheduled games have inconsistent player identities. `}Resolve these issues before replacing.</p> : <><label className="block"><input type="checkbox" className="mr-2" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the impact and want to replace this player.</label><Button disabled={!confirmed} onClick={() => { const hash = review.preview_hash; setReview(null); void run("replacePlayer", { ...proposal, preview_hash: hash }); }}>Confirm replacement</Button></>}</div>}</fieldset></section>;
}
