import type { ValidationIssue } from './definition';
import { graphDependencies, graphOrder, graphSources, type GraphDefinition, type GraphNode, type GraphSource } from './graph-types';
/** Node contract only; envelope policy/time checks belong to validateDefinition. */
export function validateGraph(definition: GraphDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (message: string, path: string, id?: string, code: ValidationIssue['code'] = 'INCOMPATIBLE_CONNECTION') => issues.push({ code, message, field_path: path, ...(id ? { node_id: id } : {}) });
  const nodes = definition.nodes;
  if (!Array.isArray(nodes) || !nodes.length) {
    issue('Graph requires nodes.', 'nodes');
    return issues;
  }
  if (nodes.length > 64) {
    issue('Graph supports at most 64 nodes.', 'nodes', undefined, 'INVALID_CAPACITY');
    return issues;
  }
  if (!definition.registration || !Number.isInteger(definition.registration.max_entries) || !Number.isInteger(definition.registration.min_entries)) {
    issue('Graph requires integer minimum and maximum roster capacity.', 'registration', undefined, 'INVALID_CAPACITY');
    return issues;
  }
  const byId = new Map<string, GraphNode>();
  const allowed: Record<string, string[]> = { 'registration@1': ['id', 'module'], 'entries@1': ['id', 'module', 'from'], 'round_robin@2': ['id', 'module', 'inputs'], 'cross_play@1': ['id', 'module', 'side_a', 'side_b'], 'match@1': ['id', 'module', 'inputs'], 'placements@2': ['id', 'module', 'final', 'bronze'] };
  for (const [i, node] of nodes.entries()) {
    const path = `nodes[${i}]`;
    if (!node || typeof node !== 'object') {
      issue('Node must be an object.', path);
      continue;
    }
    if (typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(node.id) || byId.has(node.id))
      issue('Node ID must be a unique safe identifier.', `${path}.id`);
    byId.set(node.id, node);
    if (!allowed[node.module]) {
      issue('Unsupported graph module.', `${path}.module`, node.id, 'UNSUPPORTED_MODULE');
      continue;
    }
    if (Object.keys(node).some(key => !allowed[node.module].includes(key)))
      issue('Unknown node field.', path, node.id);
    if (node.module === 'round_robin@2' || node.module === 'match@1') {
      if (!Array.isArray(node.inputs) || node.inputs.length < 2 || node.inputs.length > 16 || (node.module === 'match@1' && node.inputs.length !== 2))
        issue('Block requires two match inputs or 2–16 pool inputs.', `${path}.inputs`, node.id, 'INVALID_CAPACITY');
    }
    if (node.module === 'cross_play@1' && (!Array.isArray(node.side_a) || !Array.isArray(node.side_b) || node.side_a.length < 1 || node.side_b.length < 1 || node.side_a.length + node.side_b.length > 16))
      issue('Cross-play requires two nonempty sides with at most 16 total entries.', path, node.id, 'INVALID_CAPACITY');
  }
  if (issues.length)
    return issues;
  for (const moduleId of ['registration@1', 'entries@1', 'placements@2']) {
    const count = nodes.filter(n => n.module === moduleId).length;
    if (count !== 1)
      issue(`Graph requires exactly one ${moduleId}.`, 'nodes', undefined, count === 0 ? 'MISSING_FIELD' : 'INCOMPATIBLE_CONNECTION');
  }
  const consumed = new Set<string>(), seeds: number[] = [];
  for (const [i, node] of nodes.entries()) {
    const path = `nodes[${i}]`;
    if (node.module === 'entries@1' && byId.get(node.from)?.module !== 'registration@1')
      issue('Entries must follow registration.', `${path}.from`, node.id, byId.has(node.from) ? 'INCOMPATIBLE_CONNECTION' : 'MISSING_FIELD');
    if (node.module === 'placements@2') {
      if (byId.get(node.final)?.module !== 'match@1' || (node.bronze !== undefined && (node.bronze === node.final || byId.get(node.bronze)?.module !== 'match@1')))
        issue('Placements require a final and optional distinct bronze match.', path, node.id, !byId.has(node.final) || node.bronze !== undefined && !byId.has(node.bronze) ? 'MISSING_FIELD' : 'INCOMPATIBLE_CONNECTION');
    }
    const sources = graphSources(node);
    if (!sources.length)
      continue;
    for (const [slot, source] of sources.entries()) {
      const sp = node.module === 'cross_play@1' ? `${path}.${slot < node.side_a.length ? `side_a[${slot}]` : `side_b[${slot - node.side_a.length}]`}` : `${path}.inputs[${slot}]`;
      if (!source || typeof source !== 'object' || !['seed', 'rank', 'winner', 'loser'].includes(source.kind)) {
        issue('Unknown source kind.', sp, node.id);
        continue;
      }
      const fields = source.kind === 'seed' ? ['kind', 'seed'] : source.kind === 'rank' ? ['kind', 'node_id', 'rank'] : ['kind', 'node_id'];
      if (Object.keys(source).some(k => !fields.includes(k)))
        issue('Unknown source field.', sp, node.id);
      const key = source.kind === 'seed' ? `seed:${source.seed}` : `${source.kind}:${source.node_id}:${source.kind === 'rank' ? source.rank : ''}`;
      if (consumed.has(key))
        issue('An output can be consumed only once.', sp, node.id);
      consumed.add(key);
      if (source.kind === 'seed') {
        seeds.push(source.seed);
        if (!Number.isInteger(source.seed) || source.seed < 1 || source.seed > definition.registration.max_entries)
          issue('Seed outside roster capacity.', sp, node.id, 'INVALID_CAPACITY');
      }
      else {
        const feeder = byId.get(source.node_id);
        if (source.kind === 'rank') {
          const feederSources = feeder ? graphSources(feeder) : [];
          if (!['round_robin@2', 'cross_play@1'].includes(String(feeder?.module)) || !Number.isInteger(source.rank) || source.rank < 1 || source.rank > feederSources.length)
            issue('Rank must reference an available pool rank.', sp, node.id, feeder ? 'INCOMPATIBLE_CONNECTION' : 'MISSING_FIELD');
        }
        else if (feeder?.module !== 'match@1')
          issue('Winner/loser must reference a match.', sp, node.id, feeder ? 'INCOMPATIBLE_CONNECTION' : 'MISSING_FIELD');
      }
    }
  }
  if (seeds.length !== definition.registration.max_entries || new Set(seeds).size !== seeds.length)
    issue('Capacity seeds must partition all planned roster slots.', 'registration', '', seeds.length < definition.registration.max_entries && new Set(seeds).size === seeds.length ? 'MISSING_FIELD' : 'INVALID_CAPACITY');
  if (issues.length)
    return issues;
  let ordered: GraphNode[];
  try {
    ordered = graphOrder(definition);
  }
  catch {
    issue('Graph contains a cycle or missing reference.', 'nodes');
    return issues;
  }
  const positions = new Map(ordered.map((node, index) => [node.id, index]));
  const comparisons = new Map<string, boolean>();
  const sourceKey = (source: GraphSource) => source.kind === 'seed' ? `seed:${source.seed}` : `${source.node_id}:${source.kind}:${source.kind === 'rank' ? source.rank : ''}`;
  function mayOverlap(a: GraphSource, b: GraphSource): boolean {
    const key = [sourceKey(a), sourceKey(b)].sort().join('|');
    const cached = comparisons.get(key);
    if (cached !== undefined) return cached;
    let overlap: boolean;
    if (a.kind === 'seed' && b.kind === 'seed') overlap = a.seed === b.seed;
    else if (a.kind !== 'seed' && b.kind !== 'seed' && a.node_id === b.node_id) {
      // Distinct ranks and a match's winner/loser are mutually exclusive ports.
      overlap = a.kind === b.kind && (a.kind !== 'rank' || (b.kind === 'rank' && a.rank === b.rank));
    } else {
      // Expand the later producer first, preserving upstream port exclusivity until
      // both paths meet. Expanding both to raw seeds would lose that guarantee.
      const positionA = a.kind === 'seed' ? -1 : positions.get(a.node_id)!;
      const positionB = b.kind === 'seed' ? -1 : positions.get(b.node_id)!;
      const later = positionA > positionB ? a : b;
      const other = positionA > positionB ? b : a;
      const producer = later.kind === 'seed' ? undefined : byId.get(later.node_id);
      overlap = !!producer && graphSources(producer).some(source => mayOverlap(source, other));
    }
    comparisons.set(key, overlap);
    return overlap;
  }
  for (const node of ordered) {
    const sources = graphSources(node);
    if (!sources.length)
      continue;
    for (let i = 0; i < sources.length; i++)
      for (let j = i + 1; j < sources.length; j++) {
        if (mayOverlap(sources[i], sources[j]))
          issue('Inputs may resolve to the same entry.', 'nodes', node.id);
      }
  }
  const placements = ordered.find(n => n.module === 'placements@2');
  if (placements?.module === 'placements@2' && placements.bronze) {
    const final = byId.get(placements.final), bronze = byId.get(placements.bronze);
    if (final?.module === 'match@1' && bronze?.module === 'match@1' && !final.inputs.every(s => s.kind === 'winner' && bronze.inputs.some(b => b.kind === 'loser' && b.node_id === s.node_id)))
      issue('Bronze must consume the losers of the final feeders.', 'nodes', placements.id);
  }
  // Force missing references to surface even for non-playing modules.
  for (const n of nodes)
    if (graphDependencies(n).some(id => !byId.has(id)))
      issue('Missing node reference.', 'nodes', n.id);
  return issues;
}
