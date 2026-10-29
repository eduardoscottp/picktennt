import { MODULE_IDS, RANKING_KEYS } from './definition';

export type Rule = { kind: 'object'; fields: Record<string, Rule> } | { kind: 'string'; max: number; pattern?: RegExp } | { kind: 'enum'; values: readonly unknown[] } | { kind: 'integer'; min: number; max: number } | { kind: 'boolean' } | { kind: 'array'; item: Rule; min: number; max: number };
const object = (fields: Record<string, Rule>): Rule => ({ kind: 'object', fields });
const enumeration = (...values: unknown[]): Rule => ({ kind: 'enum', values });
const integer = (min: number, max: number): Rule => ({ kind: 'integer', min, max });
const string = (max: number, pattern?: RegExp): Rule => ({ kind: 'string', max, pattern });
const boolean: Rule = { kind: 'boolean' };
export const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const date = string(40, datePattern);
const rankingKeys = RANKING_KEYS;
export const DEFINITION_RULE = object({
  schema_version: enumeration('1.0'),
  event: object({ name: string(120), starts_at: date, expected_end_at: date, timezone: string(100), venue_name: string(200), visibility: enumeration('public', 'unlisted'), courts: integer(1, 8) }),
  registration: object({ mode: enumeration('open', 'approval'), entry_type: enumeration('singles', 'fixed_doubles'), max_entries: integer(2, 16), min_entries: integer(2, 16), closes_at: date, partner_consent: boolean, organizer_plays: boolean }),
  policies: object({ match: object({ version: enumeration(1), games: enumeration(1), target: enumeration(11, 15, 21), win_by: enumeration(1, 2), cap: enumeration(null), scoring: enumeration('side_out', 'rally') }), ranking: object({ version: enumeration(1), order: { kind: 'array', item: enumeration(...rankingKeys), min: 1, max: 5 }, final_tie: enumeration('recorded_draw') }), confirmation: enumeration('opponent_or_admin_v1'), withdrawal: enumeration('stage_sensitive_v1'), correction: enumeration('impact_review_void_and_replay_v1') }),
  scheduling: object({ estimated_slot_minutes: integer(5, 120), minimum_rest_minutes: integer(0, 30), contingency_minutes: integer(0, 240) }),
  // Config is parsed against the declared module separately.
  nodes: { kind: 'array', min: 4, max: 7, item: object({ id: string(40, /^[a-zA-Z0-9_-]+$/), module: enumeration(...MODULE_IDS) }) },
});

/** Shared by validation and discovery: supplied draft values obey the complete contract. */
export function nodeRule(moduleId: unknown, includeEmptyConfig: boolean): Rule {
  const fields: Record<string, Rule> = { id: string(40, /^[a-zA-Z0-9_-]+$/), module: enumeration(...MODULE_IDS) };
  if (moduleId !== 'registration@1') fields.from = string(40, /^[a-zA-Z0-9_-]+$/);
  if (moduleId === 'qualify@1') fields.config = object({ count: enumeration(2, 4) });
  else if (moduleId === 'elimination@1') fields.config = object({ seeding: enumeration('draw', 'ranked'), bronze: boolean });
  else if (includeEmptyConfig) fields.config = object({});
  return object(fields);
}
export interface DefinitionJsonSchema {
  type?: string; description?: string; properties?: Record<string, DefinitionJsonSchema>; required?: string[];
  additionalProperties?: false; enum?: readonly unknown[]; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; pattern?: string; items?: DefinitionJsonSchema;
  minItems?: number; maxItems?: number; oneOf?: DefinitionJsonSchema[]; anyOf?: DefinitionJsonSchema[]; uniqueItems?: boolean;
  allOf?: DefinitionJsonSchema[]; if?: DefinitionJsonSchema; then?: DefinitionJsonSchema;
}
export function graphNodeSchemas(partial = false): DefinitionJsonSchema[] {
  const id: DefinitionJsonSchema = { type: 'string', minLength: 1, maxLength: 40, pattern: '^[a-zA-Z0-9_-]+$' };
  const position: DefinitionJsonSchema = { type: 'integer', minimum: 1, maximum: 16 };
  const shape = (properties: Record<string, DefinitionJsonSchema>, required = Object.keys(properties)): DefinitionJsonSchema => ({ type: 'object', properties, required: partial ? [] : required, additionalProperties: false });
  const source: DefinitionJsonSchema = { [partial ? 'anyOf' : 'oneOf']: [
    shape({ kind: { enum: ['seed'] }, seed: position }),
    shape({ kind: { enum: ['rank'] }, node_id: id, rank: position }),
    shape({ kind: { enum: ['winner', 'loser'] }, node_id: id }),
  ] };
  return [
    shape({ id, module: { enum: ['registration@1'] } }),
    shape({ id, module: { enum: ['entries@1'] }, from: id }),
    shape({ id, module: { enum: ['round_robin@2'] }, inputs: { type: 'array', minItems: 2, maxItems: 16, items: source } }),
    shape({ id, module: { enum: ['cross_play@1'] }, side_a: { type: 'array', minItems: 1, maxItems: 15, items: source }, side_b: { type: 'array', minItems: 1, maxItems: 15, items: source } }),
    shape({ id, module: { enum: ['match@1'] }, inputs: { type: 'array', minItems: 2, maxItems: 2, items: source } }),
    shape({ id, module: { enum: ['placements@2'] }, final: id, bronze: id }, ['id', 'module', 'final']),
  ];
}
export function ruleJsonSchema(rule: Rule, partial = false, path = ''): DefinitionJsonSchema {
  if (rule.kind === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(rule.fields).map(([key, value]) => [key, ruleJsonSchema(value, partial, path ? `${path}.${key}` : key)])), required: partial ? [] : Object.keys(rule.fields), additionalProperties: false };
  if (rule.kind === 'enum') return { enum: [...rule.values] };
  if (rule.kind === 'integer') return { type: 'integer', minimum: rule.min, maximum: rule.max };
  if (rule.kind === 'boolean') return { type: 'boolean' };
  if (rule.kind === 'string') return { type: 'string', minLength: 1, maxLength: rule.max, ...(rule.pattern ? { pattern: rule.pattern.source } : {}), description: 'Nonempty text without leading or trailing whitespace.' };
  if (path === 'nodes') {
    const alternatives = MODULE_IDS.map(moduleId => {
      const node = ruleJsonSchema(nodeRule(moduleId, true), partial);
      node.properties!.module = { enum: [moduleId] };
      if (!partial && moduleId !== 'qualify@1' && moduleId !== 'elimination@1') node.required = node.required!.filter(key => key !== 'config');
      return node;
    });
    return { type: 'array', minItems: partial ? 0 : rule.min, maxItems: rule.max, items: partial ? { anyOf: alternatives } : { oneOf: alternatives }, description: 'Use one advertised composition in order, unique node IDs, and from equal to the preceding node ID. Drafts may omit nodes or contain a supported prefix. Direct elimination uses draw; qualified elimination uses ranked. Bronze requires at least four bracket entries.' };
  }
  return { type: 'array', items: ruleJsonSchema(rule.item, partial), minItems: rule.min, maxItems: rule.max, ...(path === 'policies.ranking.order' ? { uniqueItems: true, description: 'First key must be wins_desc. Remaining keys are optional unique secondary ranking criteria, in priority order.' } : {}) };
}
export function definitionJsonSchema(partial = false): DefinitionJsonSchema {
  const schema = ruleJsonSchema(DEFINITION_RULE, partial);
  const legacyNodes = schema.properties!.nodes;
  schema.properties!.schema_version = { enum: ['1.0', '2.0'] };
  schema.properties!.nodes = { ...legacyNodes, minItems: partial ? 0 : 3, maxItems: 64, items: { [partial ? 'anyOf' : 'oneOf']: [...(legacyNodes.items?.oneOf ?? legacyNodes.items?.anyOf ?? []), ...graphNodeSchemas(partial).slice(2)] }, description: 'Version 1 uses the advertised linear compositions. Version 2 connects blocks using roster seeds, group ranks or match winners/losers. Input array order defines destination slots. validate_draft checks the graph and is authoritative.' };
  schema.allOf = [
    { if: { properties: { schema_version: { enum: ['1.0'] } }, required: ['schema_version'] }, then: { properties: { nodes: legacyNodes } } },
    { if: { properties: { schema_version: { enum: ['2.0'] } }, required: ['schema_version'] }, then: { properties: { nodes: { type: 'array', minItems: partial ? 0 : 3, maxItems: 64, items: { [partial ? 'anyOf' : 'oneOf']: graphNodeSchemas(partial) } } } } },
  ];
  return { ...schema, description: partial ? 'Partial unpublished definition. Omit unknown organizer facts; supplied values must match this contract. Missing graph decisions can be saved alongside scheduling. Updates replace the definition, so preserve saved facts.' : 'Registration publication definition. Version 2 permits min_entries below max_entries; seeds partition planned capacity slots, not actual players. Include registration, entries and the group plan; unfinished knockout connections are disclosed as pending and must be completed before generation. Shared date, identity, consent and scoring rules apply. validate_draft is authoritative.' };
}
