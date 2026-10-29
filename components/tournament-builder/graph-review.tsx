const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nodes = (definition: Record<string, unknown>) => Array.isArray(definition.nodes) ? definition.nodes.map(object) : [];

export function graphNodeLabel(nodeId: string, definition: Record<string, unknown>): string {
  const node = nodes(definition).find((item) => item.id === nodeId);
  if (node?.module === "round_robin@2") return `Group ${nodeId}`;
  if (node?.module === "cross_play@1") return `Cross-play ${nodeId}`;
  return nodeId;
}

export function graphSourceLabel(value: unknown, definition: Record<string, unknown>): string {
  const source = object(value);
  if (source.kind === "seed") return `Team ${String(source.seed)}`;
  const node = graphNodeLabel(String(source.node_id), definition);
  if (source.kind === "rank") return `${node} rank ${String(source.rank)}`;
  if (source.kind === "winner") return `Winner of ${node}`;
  if (source.kind === "loser") return `Loser of ${node}`;
  return "Awaiting source";
}

export function GraphReview({ definition }: { definition: Record<string, unknown> }) {
  const names: Record<string, string> = { "registration@1": "Registration", "entries@1": "Entries", "round_robin@2": "Group", "cross_play@1": "Cross-play", "match@1": "Match", "placements@2": "Final places" };
  return <div className="grid gap-3 sm:grid-cols-2" aria-label="Tournament blocks">{nodes(definition).map((node) => <div key={String(node.id)} className="rounded-xl border bg-gray-50 p-3">
    <h3 className="text-sm font-semibold">{names[String(node.module)] ?? "Block"} {String(node.id)}</h3>
    {typeof node.from === "string" && <p className="mt-1 text-sm">From {graphNodeLabel(node.from, definition)}</p>}
    {Array.isArray(node.inputs) && <ul className="mt-1 space-y-1 text-sm text-gray-600">{node.inputs.map((source, index) => <li key={index}>{graphSourceLabel(source, definition)}</li>)}</ul>}
    {Array.isArray(node.side_a) && <div className="mt-1 text-sm text-gray-600"><p className="font-medium">Side A</p>{node.side_a.map((source, index) => <p key={index}>{graphSourceLabel(source, definition)}</p>)}</div>}
    {Array.isArray(node.side_b) && <div className="mt-1 text-sm text-gray-600"><p className="font-medium">Side B</p>{node.side_b.map((source, index) => <p key={index}>{graphSourceLabel(source, definition)}</p>)}</div>}
    {typeof node.final === "string" && <p className="mt-1 text-sm">Final: {node.final}</p>}
    {typeof node.bronze === "string" && <p className="text-sm">Bronze: {node.bronze}</p>}
  </div>)}</div>;
}
