import { graphSources, type GraphDefinition } from './graph-types';

/** The transactional graph validator handles any graph with a deferred group. */
export function isReviewedGroupGraph(definition: GraphDefinition): boolean {
  return definition.nodes.some(node => ['round_robin@2', 'cross_play@1'].includes(node.module) && graphSources(node).some(source => source.kind !== 'seed'));
}

export function isReviewedGeneralGraph(definition: GraphDefinition): boolean {
  return isReviewedGroupGraph(definition) || definition.nodes.some(node => node.module === 'cross_play@1');
}

/** Formats not yet verified by the generation transaction retain their existing scheduling behavior. */
export function graphSupportsStageReview(definition: GraphDefinition, _stages: readonly Record<string, unknown>[]): boolean {
  if (isReviewedGeneralGraph(definition)) return true;
  const deferred = new Set(definition.nodes.filter(node => graphSources(node).some(source => source.kind !== 'seed')).map(node => node.id));
  return definition.nodes.every(node => !deferred.has(node.id) || (node.module === 'match@1' && graphSources(node).every(source => {
    if (source.kind !== 'rank') return true;
    const upstream = definition.nodes.find(candidate => candidate.id === source.node_id);
    return upstream?.module === 'round_robin@2' && upstream.inputs.every(input => input.kind === 'seed');
  })));
}
