"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StorageRow } from "@/lib/tournament-builder/commands";

type Group = { id: string; capacity: number };
export function GroupFinalization({ rosterRevision, groups, entries, pending, disabled = false, onGenerate, label: teamLabel, problems = [] }: { rosterRevision: unknown; groups: Group[]; entries: StorageRow[]; pending: boolean; disabled?: boolean; onGenerate: (payload: Record<string, unknown>) => void; label?: (id: unknown) => string; problems?: string[] }) {
  const [selection, setSelection] = useState<Record<string, string>>({});
  const assignments = Object.fromEntries(groups.map(group => [group.id, entries.filter(entry => selection[entry.id] === group.id).map(entry => entry.id)]));
  const complete = entries.length > 0 && (!groups.length || (entries.every(entry => groups.some(group => group.id === selection[entry.id])) && groups.every(group => assignments[group.id].length >= 2 && assignments[group.id].length <= group.capacity)));
  const label = (id: string) => teamLabel?.(id) ?? String(entries.find(entry => entry.id === id)?.name ?? id);
  return <fieldset className="min-w-0 space-y-3 [&_button]:h-auto [&_button]:whitespace-normal">
    <h3 className="font-semibold">Generate games</h3>{groups.length > 0 && <p className="font-medium">Assign actual teams to groups</p>}
    {groups.length > 0 && <p className="text-sm text-gray-600">Each group needs at least two teams; unused slots create no games.</p>}
    {!!groups.length && entries.map(entry => <label key={entry.id} className="block text-sm">Group for {label(entry.id)}
      <select className="ml-2 rounded-lg border p-2" value={selection[entry.id] ?? ""} onChange={e => { setSelection({ ...selection, [entry.id]: e.target.value }); }}>
        <option value="">Choose a group</option>
        {groups.map(group => <option key={group.id} value={group.id}>Group {group.id} ({assignments[group.id].length}/{group.capacity})</option>)}
      </select>
    </label>)}
    {complete && new Set(Object.values(assignments).map(ids => ids.length)).size > 1 && <p className="rounded-lg bg-amber-50 p-3 text-sm">Groups have unequal team counts, so games per team and rest can differ. Review group sizes before generating games.</p>}
    {problems.map(problem => <p role="status" className="text-sm text-amber-800" key={problem}>{problem}</p>)}
    {pending && <p className="rounded-lg bg-amber-50 p-3 text-sm">Complete pending tournament connections before generating matches.</p>}
    <Button disabled={!complete || pending || disabled || problems.length > 0} onClick={() => { if (window.confirm("Generate games? Registration will close and player positions will be locked. You can still manage the tournament and enter scores.")) onGenerate({ reviewed_roster_revision: rosterRevision, ...(groups.length ? { group_assignments: assignments } : {}) }); }}>Generate games</Button>
  </fieldset>;
}
