"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";

const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];

export function eligibleForfeitMatches(matches: StorageRow[], entryId: string) {
  return matches.filter(match => match.is_current !== false && !match.voided_at && match.status === "scheduled" && !match.started_at && match.score_a == null && match.score_b == null && !match.outcome_kind && match.team_a_id && match.team_b_id && [match.team_a_id, match.team_b_id].includes(entryId));
}
export const forfeitReviewFingerprint = (revision: unknown, proposal: Record<string, unknown>) => JSON.stringify({ revision, proposal });

export function AdministrativeForfeits({ snapshot, disabled, label, matchLabel, run }: { snapshot: CommandSnapshot; disabled: boolean; label: (id: unknown) => string; matchLabel: (id: string) => string; run: (command: string, data: Record<string, unknown>) => Promise<void> }) {
  const [entryId, setEntryId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [regenerate, setRegenerate] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ fingerprint: string; result: Record<string, unknown> } | null>(null);
  const event = snapshot.event!;
  const eligible = eligibleForfeitMatches(snapshot.matches, entryId);
  const proposal = { entry_id: entryId, match_ids: selected, mode: "walkover", reason: reason.trim(), overwrite_existing: false, regenerate_downstream: regenerate };
  const fingerprint = forfeitReviewFingerprint(event.revision, proposal);
  const current = review?.fingerprint === fingerprint ? review.result : null;
  const archived = rows(current?.archived_matches), changed = rows(current?.changed_fixtures), standings = rows(current?.standings);
  const selectedResults = rows(current?.selected_matches);

  async function preview() {
    setBusy(true); setError(""); setAccepted(false); setReview(null);
    try {
      const response = await fetch(`/api/tournament-builder/${event.id}/preview?kind=bulk-adjudication`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok || typeof result.preview_hash !== "string") throw new Error(typeof result.message === "string" ? result.message : "Could not review these forfeits.");
      if (Number(result.event_revision) !== Number(event.revision)) throw new Error("Tournament changed. Refresh before reviewing again.");
      setReview({ fingerprint, result });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not review these forfeits."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-gray-200 p-4"><summary className="cursor-pointer font-semibold">Apply walkovers / forfeits to pending matches</summary><div className="mt-3 space-y-3 text-sm"><p>Choose the team forfeiting. Its opponents win the selected games without invented points. The team remains in the tournament; withdrawing it is a separate action.</p><p>For a game already in progress, <Link className="font-semibold text-brand-600 underline" href={`/tournaments/${event.id}/matches`}>open Matches</Link>, select the game, and choose Retirement and the winner. Correct saved results separately.</p><fieldset disabled={disabled || busy} className="space-y-3 disabled:opacity-60"><label className="block">Forfeiting team<select aria-label="Forfeiting team" className="mt-1 block w-full rounded-lg border bg-white p-2" value={entryId} onChange={event => { setEntryId(event.target.value); setSelected([]); setReview(null); setAccepted(false); }}><option value="">Choose a team</option>{snapshot.teams.filter(team => team.entry_state === "approved").map(team => <option key={team.id} value={team.id}>{label(team.id)}</option>)}</select></label>
    {entryId && (eligible.length ? <div className="space-y-2"><p>Select unstarted games. Completed, scored and in-progress games are excluded here; manage those individually.</p>{eligible.map(match => <label key={match.id} className="block rounded-lg border p-2"><input type="checkbox" className="mr-2" checked={selected.includes(match.id)} onChange={event => { setSelected(current => event.target.checked ? [...current, match.id] : current.filter(id => id !== match.id)); setAccepted(false); }} />{matchLabel(match.id)}</label>)}</div> : <p>No eligible unstarted games for this team.</p>)}
    <Input label="Reason for forfeits" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); setAccepted(false); }} />
    <label className="block"><input type="checkbox" className="mr-2" checked={regenerate} onChange={event => { setRegenerate(event.target.checked); setAccepted(false); }} />Review archiving and regenerating affected later games if needed</label>
    <Button size="sm" variant="outline" disabled={!entryId || !selected.length || selected.length > 64 || !reason.trim()} onClick={() => void preview()}>Review forfeits and consequences</Button>{selected.length > 64 && <p role="alert">Select no more than 64 matches per review.</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    {current && <div className="space-y-3 rounded-lg bg-amber-50 p-3"><p className="font-semibold">Proposed outcomes</p><ul className="list-disc pl-5">{selectedResults.map(result => <li key={String(result.match_id)}>{matchLabel(String(result.match_id))}: {label(row(result.after).winner_team_id)} wins by walkover.</li>)}</ul><p>{archived.length} later {archived.length === 1 ? "match will" : "matches will"} be archived for regeneration.</p>{archived.length > 0 && <ul className="list-disc pl-5">{archived.map(match => <li key={String(match.match_id)}>{matchLabel(String(match.match_id))} · {String(match.status ?? "unknown")} · {String(match.score_a ?? "–")} : {String(match.score_b ?? "–")}</li>)}</ul>}{changed.length > 0 && <><p className="font-semibold">Resulting fixtures</p><ul className="list-disc pl-5">{changed.map(match => <li key={String(match.match_id)}>{label(match.after_team_a_id)} vs {label(match.after_team_b_id)}{match.new_fixture === true ? " · new" : " · updated"}</li>)}</ul></>}{standings.length > 0 && <><p className="font-semibold">Projected standings</p><ul className="list-disc pl-5">{standings.map((standing, index) => <li key={`${String(standing.stage_id)}-${String(standing.team_id)}-${index}`}>{label(standing.team_id)} · rank {String(standing.rank ?? "pending")} · {String(standing.wins ?? 0)} wins, {String(standing.losses ?? 0)} losses</li>)}</ul></>}{rows(current.qualification).length > 0 && <><p className="font-semibold">Qualification changes</p><ul className="list-disc pl-5">{rows(current.qualification).map((item, index) => <li key={String(item.stage_id ?? index)}>Before: {(Array.isArray(item.before_entry_ids) ? item.before_entry_ids : []).map(label).join(", ") || "pending"} · After: {(Array.isArray(item.after_entry_ids) ? item.after_entry_ids : []).map(label).join(", ") || "pending"}</li>)}</ul></>}{rows(current.preserved_intermediate_matches).length > 0 && <><p className="font-semibold">Other played or started matches preserved</p><ul className="list-disc pl-5">{rows(current.preserved_intermediate_matches).map(item => <li key={String(item.id)}>{matchLabel(String(item.id))} · {String(item.status ?? "unknown")} · {String(item.score_a ?? "–")} : {String(item.score_b ?? "–")}</li>)}</ul></>}{current.dupr_history_unknown === true && <p>Previously played matches may have been submitted to DUPR. Review them separately; this action does not update DUPR.</p>}{typeof current.blocked_code === "string" && current.blocked_code && <p>Further tournament action may be required: {String(current.blocked_code)}.</p>}<label className="block"><input type="checkbox" className="mr-2" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I reviewed the results and any archived matches and accept these consequences.</label><Button size="sm" variant="danger" disabled={!accepted} onClick={() => void run("bulkAdjudicate", { ...proposal, preview_hash: current.preview_hash })}>Confirm reviewed forfeits</Button></div>}
  </fieldset></div></details>;
}
