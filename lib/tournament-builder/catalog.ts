import type { ModuleId } from './definition';
import { definitionJsonSchema, graphNodeSchemas } from './definition-schema';
import { OWNER_ACTIONS } from './owner-actions';

export const SUPPORTED_COMPOSITIONS: readonly (readonly ModuleId[])[] = [
  ['registration@1', 'entries@1', 'round_robin@1', 'standings@1', 'placements@1'],
  ['registration@1', 'entries@1', 'elimination@1', 'placements@1'],
  ['registration@1', 'entries@1', 'round_robin@1', 'standings@1', 'qualify@1', 'elimination@1', 'placements@1'],
];
export interface ModuleDescriptor {
  id: ModuleId; version: 1; description: string; input: string; output: string;
  config: Record<string, readonly (string | number | boolean)[]>;
  permitted_predecessors: readonly ModuleId[]; permitted_successors: readonly ModuleId[];
  upstream_cardinality: 0 | 1; entry_types: readonly ['singles', 'fixed_doubles'];
  preconditions: string; completion: string; corrections: string; questions: string[]; example: string;
}
const specs: { id: ModuleId; description: string; input: string; output: string; config?: ModuleDescriptor['config']; preconditions: string; completion: string; questions: string[]; example: string }[] = [
  { id: 'registration@1', description: 'Admission of complete entries using existing Picktennt accounts.', input: 'ParticipantApplications', output: 'ApprovedParticipants', preconditions: 'Published rules and either actual participant consent or explicit administrator admission of existing Picktennt profiles.', completion: 'Registration explicitly closed and eligible roster reviewed.', questions: ['Choose singles or fixed doubles, capacity, approval mode, deadline and organizer participation.'], example: '16 people in fixed doubles means 8 entries.' },
  { id: 'entries@1', description: 'Lock an eligible account roster and its seed order.', input: 'ApprovedParticipants', output: 'EntrySet', preconditions: 'Closed registration and complete approved entries.', completion: 'Roster and stable draw order committed.', questions: ['Confirm eligible roster before locking.'], example: 'Direct bracket needs actual 2, 4, 8 or 16 entries.' },
  { id: 'round_robin@1', description: 'One full all-play-all group.', input: 'EntrySet', output: 'StageResults', preconditions: '2–16 locked entries.', completion: 'Every required fixture has an accepted terminal outcome.', questions: ['Confirm full round robin and review estimated duration.'], example: '8 entries produce 28 matches.' },
  { id: 'standings@1', description: 'Rank eligible entries using published metrics.', input: 'StageResults', output: 'RankedEntries', preconditions: 'Accepted current same-stage outcomes.', completion: 'Completed round robin and required exact ties resolved by recorded draw.', questions: ['Choose supported secondary ranking keys after wins.'], example: 'Wins, differential, points for; remaining exact ties require recorded draw.' },
  { id: 'qualify@1', description: 'Advance top two or four eligible entries.', input: 'RankedEntries', output: 'EntrySet', config: { count: [2, 4] }, preconditions: 'Complete ranking and resolved cutoff/seed ties.', completion: 'Enough eligible entries selected in rank order.', questions: ['Advance top two or top four?'], example: 'Top four seeds feed semifinals 1–4 and 2–3.' },
  { id: 'elimination@1', description: 'Single elimination with optional bronze.', input: 'EntrySet', output: 'BracketResults', config: { seeding: ['draw', 'ranked'], bronze: [true, false] }, preconditions: 'Direct draw with 2/4/8/16 entries, or ranked qualifiers with 2/4.', completion: 'Final and optional bronze accepted.', questions: ['Play bronze? Direct brackets use draw, qualifiers use ranked seeds.'], example: 'Four entries: three matches, plus one when bronze enabled.' },
  { id: 'placements@1', description: 'Publish the final versioned result.', input: 'RankedEntries | BracketResults', output: 'FinalPlacements', preconditions: 'Complete results, resolved required ties and eligible champion.', completion: 'Consistent placements and result version committed.', questions: ['Review shared-third and nonqualifier placement rules.'], example: 'Without bronze, semifinal losers share third.' },
];
export const MODULE_CATALOG: readonly ModuleDescriptor[] = specs.map(spec => ({
  ...spec, version: 1, config: spec.config ?? {}, entry_types: ['singles', 'fixed_doubles'],
  upstream_cardinality: spec.id === 'registration@1' ? 0 : 1,
  permitted_predecessors: [...new Set(SUPPORTED_COMPOSITIONS.flatMap(path => path.flatMap((id, i) => id === spec.id && i > 0 ? [path[i - 1]] : [])))],
  permitted_successors: [...new Set(SUPPORTED_COMPOSITIONS.flatMap(path => path.flatMap((id, i) => id === spec.id && i < path.length - 1 ? [path[i + 1]] : [])))],
  corrections: 'Impact review required; preserve history and block changes to started dependents until explicit void-and-replay. Withdrawal follows stage_sensitive_v1.',
}));
export function listModules() {
  const descriptions: Record<string, { description: string; input: string; output: string; questions: string[] }> = {
    'round_robin@2': { description: 'One independent group, assembled from explicit entry sources.', input: '2–16 seeds or completed block outputs', output: 'Ranked positions after accepted group results and required tie draws', questions: ['Which entries enter this group?', 'Which ranks advance, and to which block slots?'] },
    'cross_play@1': { description: 'Every entry on side A plays every entry on side B, without same-side games.', input: 'Two nonempty sides with at most 16 total seeds or completed block outputs', output: 'Combined ranked positions after all cross-side results and required tie draws', questions: ['Which entries belong on each side?', 'How many ranked positions advance?'] },
    'match@1': { description: 'One match with two explicit incoming slots.', input: 'Two seeds, group ranks, match winners or match losers', output: 'Winner and loser after an accepted outcome', questions: ['Which source fills each side?', 'Where do the winner and loser play next?'] },
    'placements@2': { description: 'Final results for the completed composition.', input: 'Championship final and optional bronze match', output: 'Placements with shared ranks where the structure does not distinguish entries', questions: ['Which match decides the champion?', 'Is there a bronze match?'] },
  };
  const graphModules = graphNodeSchemas().slice(2).map(schema => {
    const id = String(schema.properties!.module.enum![0]);
    return { id, version: Number(id.split('@')[1]), schema_version: '2.0', ...descriptions[id], definition_schema: schema };
  });
  return [...structuredClone(MODULE_CATALOG), ...graphModules];
}
export function getCapabilities(administratorAccess = false, ownerAccess = false, playerAccess = false) {
  return { schema_version: '1.0' as const, sport: 'pickleball', entry_types: ['singles', 'fixed_doubles'] as const, entries: { min: 2, max: 16 }, courts: { min: 1, max: 8 }, compositions: structuredClone(SUPPORTED_COMPOSITIONS), modules: listModules(),
    definition_schema: definitionJsonSchema(), draft_definition_schema: definitionJsonSchema(true),
    graph: { schema_version: '2.0', nodes: graphNodeSchemas(), max_nodes: 64, fixed_capacity: true,
      modules: ['registration@1', 'entries@1', 'round_robin@2', 'cross_play@1', 'match@1', 'placements@2'],
      sources: ['seed: locked roster position', 'rank: completed round-robin position', 'winner: accepted match winner', 'loser: accepted match loser'],
      instructions: 'Use schema_version 2.0 for groups and branches. round_robin@2 uses inputs. cross_play@1 uses side_a and side_b and creates only side-A-versus-side-B games. match@1 uses exactly two inputs and can express seeded internal pairings such as rank 9 versus rank 1; connect each chosen match winner to the next round. Sources use kind seed with seed, rank with node_id and rank, or winner/loser with node_id. Include registration@1, entries@1 from registration, and placements@2 with final match node id and optional bronze. Seeds partition max_entries planned slots; min_entries may be lower. No players or games are required to create or publish registration. Missing graph nodes/connections are pending decisions, so supported scheduling can still be saved. Include registration and entries before publication; knockout connections may remain pending until admin_lock_roster. At lock, review actual groups and provide group_assignments by initial group node ID; each approved entry appears exactly once, groups have 2 to capacity entries. Optional nodes completes missing connections while preserving existing facts. Never generate fixtures while registration is open. Automatic best-runners-up comparison across groups is unsupported; disclose it rather than silently switching formats. No expressions or invented results. Ties affecting a selected rank must be resolved. Preview before publishing.' },
    policy_guidance: {
      'policies.match': 'One game, legal target and win-by from the schema; side_out awards points only to the serving side, rally awards each rally.',
      'policies.ranking.order': 'Wins first, then organizer-selected unique secondary criteria. Descending keys prefer larger metrics; points_against_asc prefers fewer conceded points; points_for_in_losses_desc counts points only in losses.',
      'policies.ranking.final_tie': 'An exact unresolved tie requires an owner-recorded draw; never invent or silently choose a winner.',
      'policies.confirmation': 'A submitted score is provisional until the opponent confirms or an authorized administrator attests it.',
      'policies.withdrawal': 'Stage-sensitive withdrawal: exclude incomplete round-robin participation, preserve completed-stage history, and never backfill a started playoff.',
      'policies.correction': 'Owner reviews downstream impact; started dependent games require explicit void and replay with history preserved.',
    },
    participant_enrollment: { ai_can_enroll: false, administrator_can_organize: administratorAccess, requires_picktennt_account: true, administrator_scope: 'tournaments:admin', administrator_instructions: 'Administrators organize only players who have already joined this tournament. Read registered_players and available individual positions with admin_get_tournament, then use admin_place_registered_player. No external account lookup or administrator enrollment tool is advertised.', instructions: 'Every participant joins individually through the website or freshly consented player participation tools. The connected participant identity is derived from authentication. Administrators may place, move, release or remove existing registered participants only. Doubles has independent individual positions without partner approval. Draft creation never enrolls anyone.' },
    player_participation: { available: playerAccess, scope: 'tournaments:play', instructions: 'With fresh participation consent, read published rules and positions with player_get_tournament, then join an empty individual position with player_join_tournament using only the connected account. Accept the rules explicitly. Move only your own account or cancel your own registration before fixtures. No partner approval is needed.' },
    owner_actions: { available: ownerAccess, scope: 'tournaments:owner', actions: ownerAccess ? [...OWNER_ACTIONS] : [], instructions: ownerAccess ? 'Only the current tournament owner may use owner tools. Call owner_preview_action, show only its human confirmation question and visible consequences; keep references, revisions and hashes internal, then obtain explicit owner confirmation before owner_commit_action. Publication, cancellation, reopening results and administrator changes require separate confirmation for each current preview. This scope does not grant draft editing, player enrollment or routine administration.' : 'Owner actions require the Picktennt owner website review flow or a fresh explicit tournaments:owner consent. Existing draft or administrator consent does not authorize publication, cancellation, reopening results or administrator changes.' },
    publication: ownerAccess ? 'owner_preview_and_explicit_confirmation' : 'owner_website_review', runtime_requires_ai: false };
}
