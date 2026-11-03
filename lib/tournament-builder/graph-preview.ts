import { graphSources, type GraphDefinition } from './graph-types';
import { analyzeGraph } from './graph-runtime';
/** Declarative connections plus the same deterministic schedule used by runtime replay. */
export function graphPreview(d: GraphDefinition) {
  const entries = Array.from({ length: d.registration.max_entries }, (_, i) => ({ id: `seed-${i + 1}`, playerIds: d.registration.entry_type === 'singles' ? [`p${i}`] : [`p${i}a`, `p${i}b`] }));
  const analysis = analyzeGraph(d, entries, []);
  const waves = Math.max(0, ...analysis.fixtures.map(f => f.wave));
  return { maximumMatches: analysis.fixtures.length, estimatedMinutes: waves * d.scheduling.estimated_slot_minutes + d.scheduling.contingency_minutes, waves, blocks: d.nodes.map(n => ({ ...n, maximumMatches: analysis.fixtures.filter(f => f.stageId === n.id).length })), connections: d.nodes.flatMap(n => {
      const sources = graphSources(n);
      if (sources.length)
        return sources.map((s, slot) => ({ from: s.kind === 'seed' ? d.nodes.find(node => node.module === 'entries@1')!.id : s.node_id, to: n.id, slot, condition: s.kind === 'seed' ? `seed:${s.seed}` : s.kind === 'rank' ? `rank:${s.rank}` : s.kind }));
      if (n.module === 'entries@1')
        return [{ from: n.from, to: n.id, slot: 0, condition: 'entries' }];
      if (n.module === 'placements@2')
        return [{ from: n.final, to: n.id, slot: 0, condition: 'final' }, ...(n.bronze ? [{ from: n.bronze, to: n.id, slot: 1, condition: 'bronze' }] : [])];
      return [];
    }), fixtures: analysis.fixtures };
}
