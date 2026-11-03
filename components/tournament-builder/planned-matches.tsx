import { GraphReview } from "./graph-review";

export function PlannedMatches({ definition }: { definition: Record<string, unknown> }) {
  return <div className="space-y-4">
    <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-700">
      <h3 className="font-semibold">Planned tournament · registration draft</h3>
      <p className="mt-1">Team assignments and match times are TBD. The organizer closes registration, reviews the actual teams and groups, and locks the roster before generating matches.</p>
    </div>
    <GraphReview definition={definition} planned />
    <p className="text-xs text-gray-500">Registered players and teams are listed below. Joining does not assign a group or generate a fixture.</p>
  </div>;
}
