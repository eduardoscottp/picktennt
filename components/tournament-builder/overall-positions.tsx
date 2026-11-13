import type { CommandSnapshot } from "@/lib/tournament-builder/commands";
import { overallPositions } from "@/lib/tournament-builder/overall-positions";
import { Card, CardContent } from "@/components/ui/card";

/** Display competition places separately from each stage's qualification table. */
export function OverallPositions({ snapshot, label }: { snapshot: CommandSnapshot; label: (id: unknown) => string }) {
  const groups = overallPositions(snapshot);
  if (!groups.length) return null;
  const provisional = groups.some(group => group.provisional);
  return <section aria-label="Overall tournament positions" className="space-y-3">
    <h3 className="text-lg font-black text-gray-900">Overall tournament positions</h3>
    <p className="text-sm text-gray-600">{snapshot.event?.modular_state === "completed" ? "Final positions are based on the tournament results." : provisional ? "Only known places are shown; provisional places are decided when their placement matches are validated. Other places may still be undecided." : "Only places determined by validated matches are shown. Other places may still be undecided."} Stage standings remain below.</p>
    <div className="space-y-2">{groups.map(group => <Card key={`${group.rankLabel}-${group.entryIds.join(':')}`}><CardContent className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-3">
      <span className="text-sm font-bold text-brand-600" aria-label={`Place ${group.rankLabel}`}>{group.rankLabel}</span>
      <div className="min-w-0">{group.entryIds.map(id => <span key={id} className="block truncate font-semibold text-gray-900">{label(id)}</span>)}
        {group.provisional ? <span className="text-xs text-gray-500">{group.description} · Provisional</span> : group.entryIds.length > 1 ? <span className="text-xs text-gray-500">Shared place</span> : null}
      </div>
    </CardContent></Card>)}</div>
  </section>;
}
