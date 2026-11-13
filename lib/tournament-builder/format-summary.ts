import type { TournamentDefinition } from './definition';

/** Describe only the routes specified in a validated v1 definition. */
export function formatSummary(definition: TournamentDefinition): string | null {
  if (definition.schema_version !== '1.0') return null;
  const roundRobin = definition.nodes.some(node => node.module === 'round_robin@1');
  const qualification = definition.nodes.find(node => node.module === 'qualify@1');
  const elimination = definition.nodes.find(node => node.module === 'elimination@1');
  if (!elimination || elimination.module !== 'elimination@1') {
    return roundRobin ? 'The round robin standings determine the final places. There are no further rounds.' : null;
  }
  if (!qualification || qualification.module !== 'qualify@1') {
    return 'The tournament uses a single-elimination bracket. The draw determines the initial matches.';
  }
  if (qualification.config.count === 2) return 'The top two entries advance directly to the final.';
  return `The top four entries advance to the semifinals: 1st vs 4th and 2nd vs 3rd. The winners play the final.${elimination.config.bronze ? ' The semifinal losers play for third place.' : ' The semifinal losers share third place.'}`;
}
