import { presentStandings } from './standings-presentation';
import { individualRoster } from './individual-roster';
import { definitionJsonSchema, type DefinitionJsonSchema } from './definition-schema';
import { DomainError } from './requests';
import { resolvedDefinition } from './resolved-definition';
import type { CommandSnapshot, StorageRow } from './commands';

type Shape = true | { [key: string]: Shape } | [Shape];
const scalar = true;
const fields = (names: string): Record<string, Shape> => Object.fromEntries(names.split(' ').map(key => [key, scalar]));
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function project(value: unknown, shape: Shape): unknown {
  if (shape === true) return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
  if (Array.isArray(shape)) return Array.isArray(value) ? value.map(item => project(item, shape[0])).filter(item => item !== undefined) : [];
  const source = row(value);
  return Object.fromEntries(Object.entries(shape).filter(([key]) => Object.hasOwn(source, key)).map(([key, spec]) => [key, project(source[key], spec)]).filter(([, item]) => item !== undefined));
}
function definitionShape(schema: DefinitionJsonSchema): Shape {
  if (schema.type === 'array') return [definitionShape(schema.items ?? {})];
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) return Object.assign({}, ...variants.map(definitionShape));
  if (schema.properties) return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, definitionShape(child)]));
  return scalar;
}
const definition = definitionShape(definitionJsonSchema(true));
const issue: Shape = fields('code field_path node_id');
const validation: Record<string, Shape> = { valid: scalar, errors: [issue], warnings: [issue], missing_fields: [issue], definition };
const preview: Shape = { ...validation, ...fields('revision definitionHash maximumMatches estimatedMinutes entryType thirdPlace scoring generationReady'), moduleNames: [scalar], warningCodes: [scalar], generationIssues: [issue] };
const mutation: Shape = { ...fields('definition_id entry_id entry_state admission_error runtime_state blocked_code match_id court_number source_match_id timing administrator_id user_id action slot_index position player_status released team_id team_a_id team_b_id old_user_id new_user_id'), validation, affected_match_ids: [scalar], replayed_match_ids: [scalar], selected_match_ids: [scalar], archived_match_ids: [scalar], qualifier_ids: [scalar], draw: [scalar], future_match_ids: [scalar], preserved_match_ids: [scalar] };
const receipt: Shape = { ...fields('operation_id tournament_id revision status'), data: mutation };
const player: Shape = fields('id username display_name');
const correctionMatch: Shape = fields('id team_a_id team_b_id status outcome_kind winner_team_id score_a score_b started_at result_revision');
const correction: Shape = { ...fields('event_revision source_match_id source_result_revision preview_hash requires_reopen qualification_pending dupr_history_unknown ordinary_archives_dependents'), source_before: correctionMatch, affected_matches: [correctionMatch], available_resolutions: [scalar], outcome: fields('score_a score_b outcome_kind winner_team_id'), affected_match_ids: [scalar], started_dependent_ids: [scalar], next_qualifier_ids: [scalar] };
const withdrawal: Shape = { ...fields('event_revision entry_id reason timing preview_hash empty_qualifier_slots dupr_history_unknown round_robin_results_excluded'), affected_matches: [correctionMatch], preserved_matches: [correctionMatch], affected_match_ids: [scalar], preserved_match_ids: [scalar], next_qualifier_ids: [scalar] };
const ownerPreview: Shape = { ...fields('tournament_id event_revision action preview_hash'), data: { ...fields('reason user_id reviewed_definition_hash'), acknowledged_warning_codes: [scalar] }, impact: { ...fields('opens_registration players_enrolled maximum_matches new_state results_under_review final_placements_withheld champion_will_not_be_invented target_profile_id permission_change owner_protected does_not_transfer_ownership'), definition, warnings: [issue], affected_match_ids: [scalar], accepted_results_preserved: [scalar], preserved_match_ids: [scalar], current_administrator_ids: [scalar] } };

/** Product DTOs deliberately do not mirror storage tables or forward new columns. */
function tournament(value: unknown, args: Record<string, unknown>) {
  const source = row(value), event = row(source.event);
  const rows = (key: string) => Array.isArray(source[key]) ? source[key].map(row) : [];
  const saved = resolvedDefinition({ event, definitions: rows('definitions'), stages: rows('stages') } as Pick<CommandSnapshot, 'event' | 'definitions' | 'stages'>);
  const matches = rows('matches'), offset = Number.isSafeInteger(args.match_offset) && Number(args.match_offset) >= 0 ? Number(args.match_offset) : 0;
  const page = matches.slice(offset, offset + 64), roundIds = new Set(page.map(match => match.round_id));
  return {
    roster: individualRoster({ event, caller_role: source.caller_role, definitions: rows('definitions'), stages: rows('stages'), teams: rows('teams'), team_members: rows('team_members'), tournament_players: rows('tournament_players'), matches: rows('matches'), rounds: [], standings: [] } as unknown as CommandSnapshot),
    tournament_id: project(event.id, scalar), ...row(project(event, fields('name revision roster_revision results_under_review'))),
    status: project(event.modular_state, scalar), caller_role: project(source.caller_role, scalar),
    definition_id: project(saved?.id, scalar), definition: project(saved?.definition, definition),
    entries: rows('teams').map(entry => ({ ...row(project(entry, fields('id name seed entry_state registration_slot'))), players: rows('team_members').filter(member => member.team_id === entry.id).map(member => ({ profile_id: project(member.user_id, scalar), ...row(project(member, fields('display_name membership_status'))) })) })),
    registered_players: rows('tournament_players').filter(player => player.status === 'approved').map(player => ({ profile_id: project(player.user_id, scalar), display_name: project(player.display_name, scalar), status: 'approved' })),
    administrators: rows('admins').map(admin => ({ profile_id: project(admin.user_id, scalar), display_name: project(admin.display_name, scalar) })),
    stages: rows('stages').map(stage => {
      const output = row(stage.output);
      return { ...row(project(stage, fields('id node_id module_id state input_revision blocked_code'))), placements: project(output.groups, [{ rank: scalar, entryIds: [scalar] }]), champion_entry_id: project(output.championEntryId, scalar),
        ...(output.manualMatchEntries ? { manual_match_entries: project(output.manualMatchEntries, fields('a b')) } : {}),
        entry_ids: project(output.entryIds, [scalar]), ties: project(output.ties, [[scalar]]), input_revision: project(stage.input_revision ?? output.inputRevision, scalar),
        ranking_draws: project(output.rankingDraws, [{ inputRevision: scalar, entryIds: [scalar] }]),
        seed_assignments: Object.entries(row(output.seedAssignments)).filter(([seed, entryId]) => /^(?:[1-9]|1[0-6])$/.test(seed) && typeof entryId === 'string').map(([seed, entryId]) => ({ seed: Number(seed), entry_id: entryId })),
      };
    }),
    rounds: project(rows('rounds').filter(round => roundIds.has(round.id)), [fields('id stage_id round_number round_type status logical_wave is_current')]),
    matches: project(page, [fields('id stage_id round_id team_a_id team_b_id player_a1_id player_a2_id player_b1_id player_b2_id court_number score_a score_b status outcome_kind winner_team_id result_revision started_at ended_at is_current voided_at')]),
    match_page: { offset, total: matches.length, next_offset: offset + 64 < matches.length ? offset + 64 : null },
    standings: project(presentStandings(rows('standings') as StorageRow[], rows('teams') as StorageRow[], Array.isArray(source.disciplinary_excluded_team_ids) ? source.disciplinary_excluded_team_ids as string[] : []), [fields('stage_id team_id wins losses points_for points_against rank input_revision eligible tie_group')]),
  };
}
export function publicMcpResult(name: string, value: unknown, args: Record<string, unknown> = {}): unknown {
  if (name === 'list_modules' || name === 'get_capabilities') return value;
  if (name === 'admin_get_tournament' || name === 'owner_get_tournament' || name === 'player_get_tournament') return JSON.parse(JSON.stringify(tournament(value, args)));
  if (name === 'search_tournaments') return project(value, { tournaments: [fields('id name status revision')], next_offset: scalar });
  if (name === 'get_draft') return project(value, { ...fields('tournament_id revision status'), definition });
  if (['validate_draft', 'preview_tournament'].includes(name)) return project(value, preview);
  if (name === 'get_review_link') return project(value, fields('tournament_id revision review_url publication_requires_owner_review'));
  if (name.endsWith('_find_player')) return project(value, player);
  if (name === 'admin_list_entry_matches') return project(value, { ...fields('event_revision entry_id impact_preview bulk_action_available'), matches: [fields('id stage_id round_id team_a_id team_b_id player_a1_id player_a2_id player_b1_id player_b2_id court_number score_a score_b status outcome_kind winner_team_id result_revision started_at ended_at')], match_page: fields('offset total next_offset') });
  if (name === 'admin_analyze_replan') return project(value, { ...fields('tournament_id event_revision has_started_or_recorded_results dupr_history_unknown requires_owner_reopen analysis_only executable'), changed_node_ids: [scalar], affected_node_ids: [scalar], unidentified_match_ids: [scalar], current_manual_match_entries: [fields('node_id team_a_id team_b_id')], current_nodes: (definition as Record<string, Shape>).nodes, proposed_nodes: (definition as Record<string, Shape>).nodes, affected_matches: [correctionMatch], unaffected_matches: [correctionMatch] });
  if (name === 'admin_preview_force_pending_match') return project(value, { ...fields('tournament_id event_revision match_id stage_id reason preview_hash retained_results match_status'), before: fields('team_a_id team_b_id'), after: fields('team_a_id team_b_id'), detached_feeder_ids: [scalar] });
  if (name === 'admin_preview_replay_terminal_match') return project(value, { ...fields('tournament_id event_revision match_id stage_id reason resolution preview_hash dupr_history_unknown history_preserved placements_reset prior_placement_state prior_champion_entry_id'), before: fields('id team_a_id team_b_id status started_at ended_at outcome_kind score_a score_b winner_team_id player_a1_id player_a2_id player_b1_id player_b2_id submit_to_dupr'), after: fields('team_a_id team_b_id'), detached_feeder_ids: [scalar] });
  if (name === 'admin_preview_append_terminal_match') return project(value, { ...fields('tournament_id event_revision reason preview_hash new_node_id placement_node_id placement_mode prior_champion_entry_id placements_reset'), nodes: (definition as Record<string, Shape>).nodes, sources: [fields('match_id node_id kind team_id')], fixture: fields('logical_key node_id team_a_id team_b_id wave court preserved_match_id'), preserved_match_ids: [scalar] });
  if (name === 'admin_simulate_bulk_adjudication') return project(value, { ...fields('event_revision entry_id mode complete_impact_preview bulk_action_available'), selected_matches: [{ ...fields('match_id team_a_id team_b_id'), before: fields('status outcome_kind winner_team_id score_a score_b result_revision'), after: fields('disposition outcome_kind winner_team_id score_a score_b') }], projected_source_standings: [{ node_id: scalar, rows: [fields('entryId wins losses pointsFor pointsAgainst pointsForInLosses')], ties: [[scalar]] }], potentially_affected_match_ids: [scalar] });
  if (name === 'admin_preview_bulk_adjudication') return project(value, { ...fields('event_revision entry_id mode preview_hash runtime_state blocked_code regenerate_downstream overwrite_existing reason dupr_history_unknown'), selected_matches: [{ ...fields('match_id team_a_id team_b_id'), before: fields('status outcome_kind winner_team_id score_a score_b result_revision started_at ended_at submit_to_dupr'), after: fields('disposition outcome_kind winner_team_id score_a score_b submit_to_dupr') }], archived_matches: [fields('match_id stage_id status outcome_kind team_a_id team_b_id score_a score_b winner_team_id started_at ended_at result_revision submit_to_dupr')], preserved_intermediate_matches: [fields('id stage_id status outcome_kind team_a_id team_b_id score_a score_b winner_team_id')], changed_fixtures: [fields('match_id stage_id before_team_a_id before_team_b_id after_team_a_id after_team_b_id before_status after_status after_outcome_kind after_winner_team_id before_next_winner_id after_next_winner_id before_next_loser_id after_next_loser_id new_fixture')], qualification: [{ ...fields('stage_id state blocked_code'), before_entry_ids: [scalar], after_entry_ids: [scalar] }], standings: [fields('stage_id team_id wins losses points_for points_against rank input_revision eligible tie_group')] });
  if (name === 'admin_preview_correction') return project(value, correction);
  if (name === 'admin_preview_withdrawal') return project(value, withdrawal);
  if (name === 'admin_preview_revision') return project(value, { ...fields('event_revision preview_hash reason next_state'), definition, entries: [{ ...fields('entry_id entry_name remove'), player_ids: [scalar] }], approved_entries: [{ ...fields('entry_id entry_name'), player_ids: [scalar] }], affected_match_ids: [scalar], affected_nodes: [scalar], warnings: [scalar] });
  if (name === 'admin_preview_player_replacement') return project(value, { ...fields('tournament_id event_revision team_id old_user_id new_user_id reason preview_hash'), future_match_ids: [scalar], preserved_match_ids: [scalar], unknown_history_match_ids: [scalar], blocked_future_match_ids: [scalar] });
  if (name === 'admin_preview_player_withdrawal') return project(value, { ...fields('tournament_id event_revision team_id user_id reason preview_hash'), historical_match_ids: [scalar], pending_match_ids: [scalar], live_match_ids: [scalar], unknown_history_match_ids: [scalar], inconsistent_pending_match_ids: [scalar] });
  if (name === 'admin_preview_schedule') return project(value, { ...fields('event_revision preview_hash estimated_slot_minutes'), fixtures: [{ ...fields('id stageId round wave court'), a: fields('kind entryId fixtureId'), b: fields('kind entryId fixtureId') }], fairness: [fields('entryId games idleSlots longestWait longestConsecutivePlay')], warnings: [scalar] });
  if (name === 'owner_preview_action') return project(value, ownerPreview);
  if (name === 'get_operation' || name === 'create_draft' || name === 'update_draft' || name.startsWith('admin_') || name.startsWith('player_') || name === 'owner_commit_action') return project(value, receipt);
  throw new DomainError('INVALID_REQUEST', 'Unsupported result.');
}
