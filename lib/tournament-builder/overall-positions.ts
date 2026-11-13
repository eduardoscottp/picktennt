import type { CommandSnapshot, StorageRow } from './commands';
import { resolvedDefinition } from './resolved-definition';

export interface OverallPositionGroup {
  rank: number;
  rankLabel: string;
  entryIds: string[];
  provisional: boolean;
  description?: string;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Overall tournament places do not change the standings used to seed each stage. */
export function overallPositions(snapshot: CommandSnapshot): OverallPositionGroup[] {
  if (!snapshot.event || snapshot.event.results_under_review === true) return [];
  const currentStages = snapshot.stages.filter(stage => !stage.definition_id || stage.definition_id === snapshot.event!.definition_id);
  const placement = currentStages.find(stage => stage.module_id === 'placements');
  const allowed = new Set(snapshot.teams.filter(team => team.entry_state === 'approved' && !snapshot.disciplinary_excluded_team_ids?.includes(team.id)).map(team => team.id));
  const eligible = (id: unknown): id is string => typeof id === 'string' && allowed.has(id);
  const output = object(placement?.output);

  // Published placements are authoritative, including shared ranks and non-qualifiers.
  if (snapshot.event.modular_state === 'completed') {
    if (placement?.state !== 'completed' || output.state !== 'completed' || !Array.isArray(output.groups)) return [];
    const seen = new Set<string>();
    const ranks = new Set<number>();
    const groups: OverallPositionGroup[] = [];
    for (const value of output.groups) {
      const group = object(value), rank = Number(group.rank);
      if (!Number.isSafeInteger(rank) || rank < 1 || ranks.has(rank) || !Array.isArray(group.entryIds) || !group.entryIds.every(id => typeof id === 'string')) return [];
      ranks.add(rank);
      const entryIds = group.entryIds.filter(eligible);
      if (entryIds.some(id => seen.has(id)) || new Set(entryIds).size !== entryIds.length) return [];
      entryIds.forEach(id => seen.add(id));
      if (entryIds.length) groups.push({ rank, rankLabel: String(rank), entryIds, provisional: false });
    }
    if (!eligible(output.championEntryId) || !groups.some(group => group.rank === 1 && group.entryIds.length === 1 && group.entryIds[0] === output.championEntryId)) return [];
    return groups.sort((a, b) => a.rank - b.rank);
  }
  if (snapshot.event.modular_state !== 'active') return [];

  const definition = object(resolvedDefinition(snapshot)?.definition);
  const nodes = Array.isArray(definition.nodes) ? definition.nodes.map(object) : [];
  const current = snapshot.matches.filter(match => match.is_current !== false && !match.voided_at);
  let finalMatches: StorageRow[], bronzeMatches: StorageRow[];
  if (definition.schema_version === '2.0') {
    const placementNode = nodes.find(node => node.module === 'placements@2');
    if (!placementNode || typeof placementNode.final !== 'string') return [];
    const stageId = (nodeId: unknown) => currentStages.find(stage => stage.node_id === nodeId)?.id;
    const finalStage = stageId(placementNode.final), bronzeStage = stageId(placementNode.bronze);
    finalMatches = finalStage ? current.filter(match => match.stage_id === finalStage && match.logical_key === `${placementNode.final}:match`) : [];
    bronzeMatches = bronzeStage ? current.filter(match => match.stage_id === bronzeStage && match.logical_key === `${placementNode.bronze}:match`) : [];
  } else if (definition.schema_version === '1.0') {
    const roundType = (match: StorageRow) => snapshot.rounds.find(round => round.id === match.round_id && round.is_current !== false)?.round_type;
    finalMatches = current.filter(match => roundType(match) === 'finals_gold');
    bronzeMatches = current.filter(match => roundType(match) === 'finals_bronze');
  } else return [];
  if (finalMatches.length !== 1 || bronzeMatches.length > 1) return [];
  const finalParticipants = [finalMatches[0].team_a_id, finalMatches[0].team_b_id].filter(eligible);
  if (bronzeMatches.some(match => [match.team_a_id, match.team_b_id].some(id => eligible(id) && finalParticipants.includes(id)))) return [];

  const seen = new Set<string>();
  function forMatch(match: StorageRow | undefined, first: number, description: string): OverallPositionGroup[] {
    if (!match) return [];
    const [a, b] = [match.team_a_id, match.team_b_id];
    if (a && a === b) return [];
    const participants = [a, b].filter(eligible);
    // Conflicting placement matches cannot safely award either set of positions.
    if (participants.some(id => seen.has(id))) return [];
    participants.forEach(id => seen.add(id));
    const winner = match.winner_team_id;
    if (['validated', 'walkover'].includes(String(match.status)) && ['played', 'administrative_score', 'walkover', 'retirement'].includes(String(match.outcome_kind)) && eligible(winner) && (winner === a || winner === b)) {
      const loser = winner === a ? b : a;
      return [{ rank: first, rankLabel: String(first), entryIds: [winner], provisional: false },
        ...(eligible(loser) ? [{ rank: first + 1, rankLabel: String(first + 1), entryIds: [loser], provisional: false }] : [])];
    }
    return participants.length ? [{ rank: first, rankLabel: `${first}–${first + 1}`, entryIds: participants, provisional: true, description }] : [];
  }
  const final = forMatch(finalMatches[0], 1, 'Finalist');
  const bronze = forMatch(bronzeMatches[0], 3, 'Third-place match');
  return [...final, ...bronze];
}
