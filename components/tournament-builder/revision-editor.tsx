"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import { DraftSetupEditor } from "./draft-setup-editor";
import { DraftPolicyEditor } from "./draft-policy-editor";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function canReviseTournament(state: string, matches: StorageRow[]) {
  return ["registration_open", "registration_closed", "ready", "active"].includes(state) && !matches.some(match => !!match.started_at || match.status !== "scheduled" || !!match.outcome_kind || match.score_a != null || match.score_b != null);
}
type EntryEdit = { entry_id: string; entry_name: string; player_ids: string[]; remove?: boolean };
type Payload = { definition: Record<string, unknown>; entries: EntryEdit[]; reason: string };
type Review = { preview_hash: string; event_revision: number; affected_match_ids: string[]; affected_nodes: unknown[]; approved_entries: unknown[]; warnings: unknown[]; next_state: string };
export function RevisionEditor({ snapshot, definition, disabled, run }: { snapshot: CommandSnapshot; definition: Record<string, unknown>; disabled: boolean; run: (command: string, data: Record<string, unknown>) => Promise<void> }) {
  const event = snapshot.event!;
  const structural = canReviseTournament(String(event.modular_state), snapshot.matches);
  const [source, setSource] = useState(JSON.stringify(definition, null, 2));
  const [entries, setEntries] = useState<EntryEdit[]>(() => snapshot.teams.filter(team => team.entry_state === "approved").map(team => ({ entry_id: team.id, entry_name: String(team.name ?? ""), player_ids: snapshot.team_members.filter(member => member.team_id === team.id && !["cancelled", "withdrawn"].includes(String(member.membership_status))).map(member => String(member.user_id)) })));
  const [pendingRemovals, setPendingRemovals] = useState<string[]>([]);
  const pendingEntries = snapshot.teams.filter(team => team.entry_state === "pending");
  const [reason, setReason] = useState("");
  const [name, setName] = useState(String(event.name ?? object(definition.event).name ?? ""));
  const [venue, setVenue] = useState(String(event.court_name ?? object(definition.event).venue_name ?? ""));
  const [username, setUsername] = useState("");
  const [players, setPlayers] = useState(() => [...new Set(snapshot.team_members.map(member => String(member.user_id)))].map(id => ({ id, display_name: String(snapshot.team_members.find(member => member.user_id === id)?.display_name ?? "Picktennt player") })));
  const [review, setReview] = useState<{ result: Review; payload: Payload } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let parsed: Record<string, unknown> | null = null;
  try { const value: unknown = JSON.parse(source); if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>; } catch {}
  const doubles = object(parsed?.registration).entry_type === "fixed_doubles";
  function invalidate() { setReview(null); setError(""); }
  function editEntry(index: number, patch: Partial<EntryEdit>) { setEntries(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry)); invalidate(); }
  async function lookup() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tournament-builder/players/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.replace(/^@/, "").trim() }) });
      const body = await response.json();
      if (!response.ok || typeof body.id !== "string" || typeof body.display_name !== "string") throw new Error(body.message ?? "Could not find this player.");
      setPlayers(current => [...current.filter(player => player.id !== body.id), { id: body.id, display_name: body.display_name }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Player lookup failed."); } finally { setBusy(false); }
  }
  async function previewRevision() {
    if (!parsed) return;
    const payload = { definition: parsed, entries: [...entries, ...pendingEntries.filter(team => pendingRemovals.includes(team.id)).map(team => ({ entry_id: team.id, entry_name: String(team.name ?? ""), player_ids: [], remove: true }))], reason: reason.trim() };
    setBusy(true); setReview(null); setError("");
    try {
      const response = await fetch(`/api/tournament-builder/${event.id}/preview?kind=revision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Could not review these changes.");
      if (Number(body.event_revision) !== Number(event.revision)) throw new Error("Tournament changed. Refresh before reviewing again.");
      setReview({ result: body, payload });
    } catch (e) { setError(e instanceof Error ? e.message : "Revision review failed."); } finally { setBusy(false); }
  }
  return <details className="min-w-0 space-y-4 rounded-xl border border-gray-200 p-4 [&_fieldset]:min-w-0 [&_button]:h-auto [&_button]:whitespace-normal"><summary className="cursor-pointer font-semibold">Edit tournament {structural ? "setup and teams" : "name and venue"}</summary>
    <fieldset disabled={disabled || busy} className="min-w-0 space-y-4 disabled:opacity-60">
      {structural ? <><p className="text-sm text-gray-600">Review changes before confirming. Registration will close, existing fixtures will become inactive, and groups and the new schedule must be reviewed before generating games.</p>
        {parsed && <><DraftSetupEditor definition={parsed} savedDefinition={definition} issues={[]} disabled={disabled || busy} onChange={value => { setSource(JSON.stringify(value, null, 2)); invalidate(); }} /><DraftPolicyEditor definition={parsed} disabled={disabled || busy} onChange={value => { setSource(JSON.stringify(value, null, 2)); invalidate(); }} /></>}
        <details><summary>Advanced: complete definition and stage connections</summary><textarea aria-label="Revised tournament definition" className="min-h-80 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs" value={source} onChange={e => { setSource(e.target.value); invalidate(); }} /></details>
        {!parsed && <p role="alert">Enter valid definition JSON.</p>}
        <h3 className="font-semibold">Approved teams</h3><p className="text-sm">Select existing accounts to swap players or change singles and doubles rosters. Administrator changes do not record personal consent. Removed entries remain in history.</p>
        <Input label="Find replacement by Picktennt username" value={username} onChange={e => setUsername(e.target.value)} /><Button variant="outline" disabled={!username.trim()} onClick={() => void lookup()}>Find replacement account</Button>
        {entries.map((entry, index) => <div key={entry.entry_id} className="space-y-2 rounded-lg border border-gray-200 p-3"><Input label={`Name for entry ${index + 1}`} value={entry.entry_name} maxLength={120} onChange={e => editEntry(index, { entry_name: e.target.value })} /><label className="block text-sm"><input type="checkbox" checked={!!entry.remove} onChange={e => editEntry(index, { remove: e.target.checked })} /> Remove this entry</label>{!entry.remove && Array.from({ length: doubles ? 2 : 1 }, (_, slot) => <label key={slot} className="block text-sm">Player {slot + 1}<select className="mt-1 block w-full min-w-0 max-w-full rounded-lg border border-gray-200 p-2" value={entry.player_ids[slot] ?? ""} onChange={e => { const ids = Array.from({ length: doubles ? 2 : 1 }, (_, i) => entry.player_ids[i] ?? ""); ids[slot] = e.target.value; editEntry(index, { player_ids: ids }); }}><option value="">Choose registered player</option>{players.map(player => <option key={player.id} value={player.id}>{player.display_name}</option>)}</select></label>)}{!entry.remove && !doubles && entry.player_ids.length > 1 && <Button size="sm" variant="outline" onClick={() => editEntry(index, { player_ids: entry.player_ids.slice(0, 1) })}>Keep selected player for singles</Button>}{!entry.remove && entry.player_ids.length !== (doubles ? 2 : 1) && <p className="text-sm text-amber-800">Select the resulting player roster for this entry type.</p>}</div>)}
        {pendingEntries.length > 0 && <div className="space-y-2"><h3 className="font-semibold">Pending entries</h3><p className="text-sm">Pending invitations count toward capacity. Remove them here when reducing capacity or switching singles and doubles; retained invitations must accept the current rules.</p>{pendingEntries.map(team => <label key={team.id} className="block text-sm"><input type="checkbox" checked={pendingRemovals.includes(team.id)} onChange={e => { setPendingRemovals(current => e.target.checked ? [...current, team.id] : current.filter(id => id !== team.id)); invalidate(); }} /> Remove pending entry {String(team.name ?? team.id)}</label>)}</div>}
      </> : <><p className="text-sm text-gray-600">After play has started, only name and venue can change here. Fixtures and results are preserved.</p><Input label="Tournament name" value={name} onChange={e => setName(e.target.value)} /><Input label="Venue" value={venue} onChange={e => setVenue(e.target.value)} /></>}
      <Input label="Reason for change (required)" value={reason} onChange={e => { setReason(e.target.value); invalidate(); }} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {structural ? <><Button disabled={!parsed || !reason.trim()} onClick={() => void previewRevision()}>Review proposed revision</Button>{review && <div className="space-y-3 rounded-xl bg-amber-50 p-4"><p>{review.result.affected_match_ids.length} existing fixtures become inactive. {review.result.approved_entries.length} approved entries in the reviewed roster. Next state: registration closed.</p><p>Affected stages: {review.result.affected_nodes.map(node => typeof node === "string" ? node : String(object(node).id ?? object(node).node_id ?? "Stage")).join(", ") || "None"}</p>{review.result.warnings.map((warning, i) => <p key={i}>{typeof warning === "string" ? warning : String(object(warning).message ?? JSON.stringify(warning))}</p>)}<Button onClick={() => { const reviewed = review; setReview(null); void run("reviseTournament", { ...reviewed.payload, preview_hash: reviewed.result.preview_hash }); }}>Confirm reviewed revision and close registration</Button></div>}</> : <Button disabled={!name.trim() || !venue.trim() || !reason.trim()} onClick={() => void run("updateEventDetails", { name: name.trim(), venue_name: venue.trim(), reason: reason.trim() })}>Save name and venue</Button>}
    </fieldset>
  </details>;
}
