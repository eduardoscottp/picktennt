import { analyzeGraph } from './graph-runtime';
import type { GraphDefinition, GraphRuntimeOptions } from './graph-types';
import type { TournamentEntry } from './types';

/** Preserve materialized rank slots when a participant withdraws or a slot is vacant. */
export function graphRankLocks(definition: GraphDefinition, entries: readonly TournamentEntry[], options: GraphRuntimeOptions, stages: readonly Record<string, unknown>[], matches: readonly Record<string, unknown>[], replayed: ReadonlySet<string> = new Set()): GraphRuntimeOptions['lockedRanks'] {
  if (!matches.some(match => [match.team_a_id, match.team_b_id].some(id => id == null || typeof id === 'string' && !options.eligibleEntryIds?.includes(id)))) return undefined;
  const sources = analyzeGraph(definition, entries, [], { ...options, lockedRanks: undefined }).fixtureSources;
  const slots: Record<string, Record<number, string | null>> = {};
  const withdrawnSources = new Set<string>();
  for (const match of matches) {
    const key = typeof match.logical_key === 'string' ? match.logical_key : '';
    if (replayed.has(key)) continue;
    const ports = sources[key];
    if (!ports) continue;
    for (const [index, field] of ['team_a_id', 'team_b_id'].entries()) {
      const port = ports[index], team = match[field];
      if (port.kind !== 'rank') continue;
      const stage = stages.find(row => row.node_id === port.node_id);
      const output = stage?.output && typeof stage.output === 'object' && !Array.isArray(stage.output) ? stage.output as Record<string, unknown> : {};
      const rows = Array.isArray(output.rows) ? output.rows as { entryId?: unknown }[] : [];
      const knownVacancy = team == null && Array.isArray(output.rows) && (stage?.state === 'completed' || stage?.blocked_code === 'UNRESOLVED_TIE') && port.rank > rows.filter(row => typeof row.entryId === 'string' && options.eligibleEntryIds?.includes(row.entryId)).length;
      if (!(typeof team === 'string' && team) && !knownVacancy) continue;
      const value = typeof team === 'string' && team ? team : null;
      const existing = slots[port.node_id];
      if (existing && Object.hasOwn(existing, port.rank) && existing[port.rank] !== value) throw new Error('Saved rank slots are inconsistent.');
      (slots[port.node_id] ??= {})[port.rank] = value;
      if (knownVacancy || value !== null && !options.eligibleEntryIds?.includes(value)) withdrawnSources.add(port.node_id);
    }
  }
  return Object.fromEntries([...withdrawnSources].map(node => [node, slots[node]]));
}
