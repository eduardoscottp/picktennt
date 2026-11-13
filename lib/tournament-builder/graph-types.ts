import type { LegacyTournamentDefinition } from './definition';
import type { StandingRow } from './policies';
import type { ResolvedFixture, RuntimeOptions, StageState, TournamentAnalysis } from './types';
export type GraphSource = {
  kind: 'seed';
  seed: number;
} | {
  kind: 'rank';
  node_id: string;
  rank: number;
} | {
  kind: 'winner' | 'loser';
  node_id: string;
};
export type GraphFixtureSource = GraphSource | { kind: 'entry'; entryId: string };
export type GraphNode = {
  id: string;
  module: 'registration@1';
} | {
  id: string;
  module: 'entries@1';
  from: string;
} | {
  id: string;
  module: 'round_robin@2';
  inputs: GraphSource[];
} | {
  id: string;
  module: 'cross_play@1';
  side_a: GraphSource[];
  side_b: GraphSource[];
} | {
  id: string;
  module: 'match@1';
  inputs: GraphSource[];
} | {
  id: string;
  module: 'placements@2';
  final: string;
  bronze?: string;
};
export type GraphDefinition = Omit<LegacyTournamentDefinition, 'schema_version' | 'nodes'> & {
  schema_version: '2.0';
  nodes: GraphNode[];
};
export interface GraphRuntimeOptions extends RuntimeOptions {
  lockedRanks?: Record<string, Record<number, string | null>>;
  seedAssignments?: Record<string, string>;
  manualMatchEntries?: Record<string, { a?: string; b?: string }>;
  stageInputs?: Record<string, {
    inputRevision: number;
    rankingDraws?: RuntimeOptions['rankingDraws'];
  }>;
  excludedByNode?: Record<string, string[]>;
}
export function graphManualEntries(stages: readonly Record<string, unknown>[], definition: GraphDefinition): GraphRuntimeOptions['manualMatchEntries'] {
  return Object.fromEntries(definition.nodes.filter(node => node.module === 'match@1').flatMap(node => {
    const output = stages.find(stage => stage.node_id === node.id)?.output;
    const manual = output && typeof output === 'object' && !Array.isArray(output) ? (output as Record<string, unknown>).manualMatchEntries : undefined;
    return manual === undefined ? [] : [[node.id, manual]];
  })) as GraphRuntimeOptions['manualMatchEntries'];
}
export interface GraphStageOutput {
  state: StageState;
  entryIds: string[];
  rows?: StandingRow[];
  ties?: string[][];
  inputRevision?: number;
  rankingDraws?: RuntimeOptions['rankingDraws'];
  winnerEntryId?: string | null;
  loserEntryId?: string | null;
  blockedCode?: string;
}
export type GraphAnalysis = TournamentAnalysis & {
  graphStages: Record<string, GraphStageOutput>;
  resolvedFixtures: ResolvedFixture[];
  fixtureSources: Record<string, [GraphFixtureSource, GraphFixtureSource]>;
};
export function graphSources(node: GraphNode): GraphSource[] {
  if ('inputs' in node)
    return node.inputs;
  if (node.module === 'cross_play@1')
    return [...node.side_a, ...node.side_b];
  return [];
}
export function graphDependencies(node: GraphNode): string[] {
  const sources = graphSources(node);
  if (sources.length)
    return [...new Set(sources.flatMap(s => s.kind === 'seed' ? [] : [s.node_id]))];
  if (node.module === 'entries@1')
    return [node.from];
  if (node.module === 'placements@2')
    return [node.final, ...(node.bronze ? [node.bronze] : [])];
  return [];
}
/** Definitions are validated before this function; ordering is stable across roster/result changes. */
export function graphOrder(definition: GraphDefinition): GraphNode[] {
  const ordered: GraphNode[] = [], pending = [...definition.nodes];
  while (pending.length) {
    const index = pending.findIndex(n => graphDependencies(n).every(id => ordered.some(o => o.id === id)));
    if (index < 0)
      throw new Error('Graph contains a cycle or missing dependency.');
    ordered.push(pending.splice(index, 1)[0]);
  }
  return [...ordered.filter(node => node.module !== 'placements@2'), ...ordered.filter(node => node.module === 'placements@2')];
}
