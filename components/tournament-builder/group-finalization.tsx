"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StorageRow } from "@/lib/tournament-builder/commands";
import type { EntryFairness } from "@/lib/tournament-builder/fair-scheduling";
import type { Fixture } from "@/lib/tournament-builder/types";

type Group = { id: string; capacity: number };
type ScheduleReview = { preview_hash: string; fixtures: Fixture[]; fairness: EntryFairness[]; warnings: string[]; estimated_slot_minutes: number };
export function GroupFinalization({ eventId, rosterRevision, groups, entries, reviewed, pending, onChange, onGenerate }: { eventId: string; rosterRevision: unknown; groups: Group[]; entries: StorageRow[]; reviewed: boolean; pending: boolean; onChange: () => void; onGenerate: (payload: Record<string, unknown>) => void }) {
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{ result: ScheduleReview; payload: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assignments = Object.fromEntries(groups.map(group => [group.id, entries.filter(entry => selection[entry.id] === group.id).map(entry => entry.id)]));
  const complete = entries.length > 0 && (!groups.length || (entries.every(entry => groups.some(group => group.id === selection[entry.id])) && groups.every(group => assignments[group.id].length >= 2 && assignments[group.id].length <= group.capacity)));
  const label = (id: string) => String(entries.find(entry => entry.id === id)?.name ?? id);
  const side = (source: Fixture["a"]) => source.kind === "entry" ? (source.entryId ? label(source.entryId) : "Pending qualifier") : `${source.kind} of ${"fixtureId" in source ? source.fixtureId : "pending match"}`;
  async function preview() {
    const payload = { reviewed_roster_revision: rosterRevision, ...(groups.length ? { group_assignments: assignments } : {}) };
    setBusy(true); setReview(null); setError("");
    try {
      const response = await fetch(`/api/tournament-builder/${eventId}/preview?kind=schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Could not preview this schedule.");
      setReview({ result: body, payload });
    } catch (e) { setError(e instanceof Error ? e.message : "Schedule review failed."); } finally { setBusy(false); }
  }
  return <fieldset disabled={busy} className="min-w-0 space-y-3 [&_button]:h-auto [&_button]:whitespace-normal">
    <h3 className="font-semibold">{groups.length ? "Assign actual teams to groups" : "Review actual schedule"}</h3>
    <p className="text-sm text-gray-600">Review every team and the proposed matches before generating games. Each group needs at least two teams; unused slots create no games.</p>
    {!!groups.length && entries.map(entry => <label key={entry.id} className="block text-sm">Group for {String(entry.name ?? "Entry")}
      <select className="ml-2 rounded-lg border p-2" value={selection[entry.id] ?? ""} onChange={e => { setSelection({ ...selection, [entry.id]: e.target.value }); setReview(null); setError(""); onChange(); }}>
        <option value="">Choose a group</option>
        {groups.map(group => <option key={group.id} value={group.id}>Group {group.id} ({assignments[group.id].length}/{group.capacity})</option>)}
      </select>
    </label>)}
    {complete && new Set(Object.values(assignments).map(ids => ids.length)).size > 1 && <p className="rounded-lg bg-amber-50 p-3 text-sm">Groups have unequal team counts, so games per team and rest can differ. Review fairness below.</p>}
    {pending && <p className="rounded-lg bg-amber-50 p-3 text-sm">Complete pending tournament connections before generating matches.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Button disabled={!reviewed || !complete || pending || busy} onClick={() => void preview()}>Preview matches and team rest</Button>
    {review && <div className="min-w-0 space-y-3 [&_button]:h-auto [&_button]:whitespace-normal"><p className="text-sm">Planned slots are estimates ({review.result.estimated_slot_minutes} minutes each). Rest is measured between games; future qualifiers are unresolved.</p>{review.result.warnings.map((warning, index) => <p key={index} className="rounded-lg bg-amber-50 p-3 text-sm">{warning}</p>)}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Games and rest by team</caption><thead><tr><th>Team</th><th>Games</th><th>Longest rest (slots)</th><th>Consecutive games</th></tr></thead><tbody>{review.result.fairness.map(row => <tr key={row.entryId}><td>{label(row.entryId)}</td><td>{row.games}</td><td>{row.longestWait}</td><td>{row.longestConsecutivePlay}</td></tr>)}</tbody></table></div><ol className="space-y-2 text-sm">{review.result.fixtures.map(fixture => <li key={fixture.id}>Slot {fixture.wave} · Court {fixture.court}: {side(fixture.a)} vs {side(fixture.b)}</li>)}</ol><Button disabled={!reviewed || pending || !complete} onClick={() => { const confirmed = review; setReview(null); onGenerate({ ...confirmed.payload, preview_hash: confirmed.result.preview_hash }); }}>Confirm reviewed schedule and generate matches</Button></div>}
  </fieldset>;
}
