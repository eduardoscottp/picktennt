import type { CommandActor, CommandPlan, CommandSnapshot, StorageRow } from './commands';
import { isEligibleEntry } from './disciplinary-eligibility';
import { graphDependencies, type GraphDefinition } from './graph-types';
import { resolvedDefinition } from './resolved-definition';
import { definitionHash, DomainError, UUID } from './requests';

const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const current = (match: StorageRow) => match.is_current !== false && !match.voided_at;

export function previewForcedPendingMatch(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>) {
  if (!snapshot.event) fail('NOT_FOUND', 'Tournament not found.');
  if (snapshot.event!.created_by !== actor.id && actor.role !== 'admin') fail('FORBIDDEN', 'Administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) fail('FORBIDDEN', 'Explicit administrator permission required.');
  if (snapshot.event!.modular_state !== 'active') fail('INVALID_STATE', 'An active tournament is required; completed results must first be reopened by the owner.');
  if (Object.keys(data).some(key => !['match_id', 'team_a_id', 'team_b_id', 'reason'].includes(key))) fail('INVALID_REQUEST', 'Unexpected intervention field.');
  const { match_id, team_a_id, team_b_id, reason } = data;
  if (![match_id, team_a_id, team_b_id].every(id => typeof id === 'string' && UUID.test(id)) || team_a_id === team_b_id || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) fail('INVALID_REQUEST', 'Choose two distinct teams and a reason.');
  const definition = resolvedDefinition(snapshot)?.definition as GraphDefinition | undefined;
  if (definition?.schema_version !== '2.0') fail('UNSUPPORTED_FORMAT', 'This operation currently requires a block-graph tournament.');
  const match = snapshot.matches.find(row => row.id === match_id && current(row));
  const stage = snapshot.stages.find(row => row.id === match?.stage_id);
  const node = definition!.nodes.find(row => row.id === stage?.node_id);
  if (!match || !stage || node?.module !== 'match@1' || match.logical_key !== `${node.id}:match`) fail('INVALID_STATE', 'Choose a current match block.');
  if (snapshot.matches.filter(row => current(row) && row.stage_id === stage!.id).length !== 1) fail('INVALID_STATE', 'Resolve duplicate current matches in this block first.');
  if (match!.status !== 'scheduled' || match!.started_at || match!.score_a != null || match!.score_b != null || match!.outcome_kind != null) fail('INVALID_STATE', 'Only a pending match without a result can use this operation.');
  if ([match!.player_a1_id, match!.player_a2_id, match!.player_b1_id, match!.player_b2_id].some(id => id != null)) fail('INVALID_STATE', 'This pending match has fixed player identities and needs a separate review.');
  if (definition!.nodes.some(candidate => candidate.module !== 'placements@2' && candidate.id !== node!.id && graphDependencies(candidate).includes(node!.id))) fail('UNSUPPORTED_FORMAT', 'This operation currently supports terminal matches only.');
  const placements = definition!.nodes.find(candidate => candidate.module === 'placements@2');
  if (placements?.module === 'placements@2' && placements.bronze && [placements.final, placements.bronze].includes(node!.id)) {
    const otherNodeId = placements.final === node!.id ? placements.bronze : placements.final;
    const otherStage = snapshot.stages.find(row => row.node_id === otherNodeId);
    const otherMatches = snapshot.matches.filter(row => current(row) && row.stage_id === otherStage?.id), other = otherMatches[0];
    if (otherMatches.length !== 1 || !other || !other.team_a_id || !other.team_b_id || [other.team_a_id, other.team_b_id].some(id => id === team_a_id || id === team_b_id)) fail('INVALID_STATE', 'Review the other placement match first; its teams must be known and distinct from these teams.');
  }
  const roster = record(snapshot.stages.find(row => row.module_id === 'entries')?.output).entryIds;
  if (!Array.isArray(roster) || ![team_a_id, team_b_id].every(id => roster.includes(id) && snapshot.teams.some(team => team.id === id && isEligibleEntry(snapshot,team)))) fail('INVALID_STATE', 'Both teams must belong to the locked roster and remain eligible.');
  const required = definition!.registration.entry_type === 'singles' ? 1 : 2;
  if (![team_a_id, team_b_id].every(id => { const team = snapshot.teams.find(item => item.id === id)!; return (!Array.isArray(team.guest_players) || !team.guest_players.length) && new Set(snapshot.team_members.filter(member => member.team_id === id && member.membership_status === 'active' && typeof member.user_id === 'string').map(member => member.user_id)).size === required; })) fail('INCOMPLETE_ROSTER', 'Both teams require a complete current roster of registered players.');
  const wave = snapshot.rounds.find(round => round.id === match!.round_id)?.logical_wave;
  if (wave == null) fail('INVALID_STATE', 'The current scheduling wave is unavailable.');
  if (snapshot.matches.some(other => current(other) && other.id !== match!.id && snapshot.rounds.find(round => round.id === other.round_id)?.logical_wave === wave && ['scheduled', 'in_progress'].includes(String(other.status)) && (!other.team_a_id || !other.team_b_id || [other.team_a_id, other.team_b_id].some(team => team === team_a_id || team === team_b_id)))) fail('INVALID_STATE', 'Another pending or live match in this wave may use one of these teams.');
  if (match!.team_a_id === team_a_id && match!.team_b_id === team_b_id) fail('INVALID_STATE', 'Those teams are already assigned to the match.');
  const feeders = snapshot.matches.filter(row => current(row) && (row.bracket_next_winner_match_id === match_id || row.bracket_next_loser_match_id === match_id));
  const review = { tournament_id: snapshot.event!.id, event_revision: Number(snapshot.event!.revision), match_id: match!.id, stage_id: stage!.id, before: { team_a_id: match!.team_a_id ?? null, team_b_id: match!.team_b_id ?? null }, after: { team_a_id, team_b_id }, reason: (reason as string).trim(), detached_feeder_ids: feeders.map(row => row.id).sort(), retained_results: true, match_status: 'scheduled' };
  return { ...review, preview_hash: definitionHash(review) };
}

export function planForcedPendingMatch(snapshot: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>): CommandPlan {
  const { preview_hash, ...proposal } = data;
  const review = previewForcedPendingMatch(snapshot, actor, proposal);
  if (preview_hash !== review.preview_hash) fail('STALE_PREVIEW', 'Review the exact current intervention before confirming.');
  const stage = snapshot.stages.find(row => row.id === review.stage_id)!;
  const matches: StorageRow[] = [{ id: review.match_id, team_a_id: review.after.team_a_id, team_b_id: review.after.team_b_id, revision: review.event_revision + 1 }];
  for (const feeder of snapshot.matches.filter(row => review.detached_feeder_ids.includes(row.id))) {
    const patch: StorageRow = { id: feeder.id };
    if (feeder.bracket_next_winner_match_id === review.match_id) { patch.bracket_next_winner_match_id = null; patch.bracket_winner_fills_side = null; }
    if (feeder.bracket_next_loser_match_id === review.match_id) { patch.bracket_next_loser_match_id = null; patch.bracket_loser_fills_side = null; }
    matches.push(patch);
  }
  return { effects: { matches, stages: [{ id: stage.id, output: { ...record(stage.output), manualMatchEntries: { a: review.after.team_a_id, b: review.after.team_b_id } } }] }, result: { match_id: review.match_id, team_a_id: review.after.team_a_id, team_b_id: review.after.team_b_id } };
}
