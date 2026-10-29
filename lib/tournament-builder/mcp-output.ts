import { definitionJsonSchema, type DefinitionJsonSchema } from './definition-schema';
import { DomainError } from './requests';
import { resolvedDefinition } from './resolved-definition';
import type { CommandSnapshot } from './commands';

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
const mutation: Shape = { ...fields('definition_id entry_id entry_state admission_error runtime_state blocked_code match_id court_number source_match_id timing administrator_id user_id action'), validation, affected_match_ids: [scalar], replayed_match_ids: [scalar], qualifier_ids: [scalar], draw: [scalar] };
const receipt: Shape = { ...fields('operation_id tournament_id revision status'), data: mutation };
const player: Shape = fields('id username display_name');
const correction: Shape = { ...fields('event_revision source_match_id source_result_revision preview_hash requires_reopen qualification_pending'), outcome: fields('score_a score_b outcome_kind winner_team_id'), affected_match_ids: [scalar], started_dependent_ids: [scalar], next_qualifier_ids: [scalar] };
const withdrawal: Shape = { ...fields('event_revision entry_id reason timing preview_hash empty_qualifier_slots'), affected_match_ids: [scalar], preserved_match_ids: [scalar], next_qualifier_ids: [scalar] };
const ownerPreview: Shape = { ...fields('tournament_id event_revision action preview_hash'), data: { ...fields('reason user_id reviewed_definition_hash'), acknowledged_warning_codes: [scalar] }, impact: { ...fields('opens_registration players_enrolled maximum_matches new_state results_under_review final_placements_withheld champion_will_not_be_invented target_profile_id permission_change owner_protected does_not_transfer_ownership'), definition, warnings: [issue], affected_match_ids: [scalar], accepted_results_preserved: [scalar], preserved_match_ids: [scalar], current_administrator_ids: [scalar] } };

/** Product DTOs deliberately do not mirror storage tables or forward new columns. */
function tournament(value: unknown, args: Record<string, unknown>) {
  const source = row(value), event = row(source.event);
  const rows = (key: string) => Array.isArray(source[key]) ? source[key].map(row) : [];
  const saved = resolvedDefinition({ event, definitions: rows('definitions'), stages: rows('stages') } as Pick<CommandSnapshot, 'event' | 'definitions' | 'stages'>);
  const matches = rows('matches'), offset = Number.isSafeInteger(args.match_offset) && Number(args.match_offset) >= 0 ? Number(args.match_offset) : 0;
  const page = matches.slice(offset, offset + 64), roundIds = new Set(page.map(match => match.round_id));
  return {
    tournament_id: project(event.id, scalar), ...row(project(event, fields('name revision roster_revision results_under_review'))),
    status: project(event.modular_state, scalar), caller_role: project(source.caller_role, scalar),
    definition_id: project(saved?.id, scalar), definition: project(saved?.definition, definition),
    entries: rows('teams').map(entry => ({ ...row(project(entry, fields('id name seed entry_state'))), players: rows('team_members').filter(member => member.team_id === entry.id).map(member => ({ profile_id: project(member.user_id, scalar), ...row(project(member, fields('display_name membership_status admission_source'))) })) })),
    administrators: rows('admins').map(admin => ({ profile_id: project(admin.user_id, scalar), display_name: project(admin.display_name, scalar) })),
    stages: rows('stages').map(stage => {
      const output = row(stage.output);
      return { ...row(project(stage, fields('id node_id module_id state input_revision blocked_code'))), placements: project(output.groups, [{ rank: scalar, entryIds: [scalar] }]), champion_entry_id: project(output.championEntryId, scalar),
        entry_ids: project(output.entryIds, [scalar]), ties: project(output.ties, [[scalar]]), input_revision: project(stage.input_revision ?? output.inputRevision, scalar),
        ranking_draws: project(output.rankingDraws, [{ inputRevision: scalar, entryIds: [scalar] }]),
        seed_assignments: Object.entries(row(output.seedAssignments)).filter(([seed, entryId]) => /^(?:[1-9]|1[0-6])$/.test(seed) && typeof entryId === 'string').map(([seed, entryId]) => ({ seed: Number(seed), entry_id: entryId })),
      };
    }),
    rounds: project(rows('rounds').filter(round => roundIds.has(round.id)), [fields('id stage_id round_number round_type status logical_wave is_current')]),
    matches: project(page, [fields('id stage_id round_id team_a_id team_b_id court_number score_a score_b status outcome_kind winner_team_id result_revision started_at ended_at is_current voided_at')]),
    match_page: { offset, total: matches.length, next_offset: offset + 64 < matches.length ? offset + 64 : null },
    standings: project(source.standings, [fields('stage_id team_id wins losses points_for points_against rank input_revision eligible tie_group')]),
  };
}
export function publicMcpResult(name: string, value: unknown, args: Record<string, unknown> = {}): unknown {
  if (name === 'list_modules' || name === 'get_capabilities') return value;
  if (name === 'admin_get_tournament' || name === 'owner_get_tournament') return JSON.parse(JSON.stringify(tournament(value, args)));
  if (name === 'get_draft') return project(value, { ...fields('tournament_id revision status'), definition });
  if (['validate_draft', 'preview_tournament'].includes(name)) return project(value, preview);
  if (name === 'get_review_link') return project(value, fields('tournament_id revision review_url publication_requires_owner_review'));
  if (name.endsWith('_find_player')) return project(value, player);
  if (name === 'admin_preview_correction') return project(value, correction);
  if (name === 'admin_preview_withdrawal') return project(value, withdrawal);
  if (name === 'admin_preview_revision') return project(value, { ...fields('event_revision preview_hash reason next_state'), definition, entries: [{ ...fields('entry_id entry_name remove'), player_ids: [scalar] }], approved_entries: [{ ...fields('entry_id entry_name'), player_ids: [scalar] }], affected_match_ids: [scalar], affected_nodes: [scalar], warnings: [scalar] });
  if (name === 'admin_preview_schedule') return project(value, { ...fields('event_revision preview_hash estimated_slot_minutes'), fixtures: [{ ...fields('id stageId round wave court'), a: fields('kind entryId fixtureId'), b: fields('kind entryId fixtureId') }], fairness: [fields('entryId games idleSlots longestWait longestConsecutivePlay')], warnings: [scalar] });
  if (name === 'owner_preview_action') return project(value, ownerPreview);
  if (name === 'get_operation' || name === 'create_draft' || name === 'update_draft' || name.startsWith('admin_') || name === 'owner_commit_action') return project(value, receipt);
  throw new DomainError('INVALID_REQUEST', 'Unsupported result.');
}
