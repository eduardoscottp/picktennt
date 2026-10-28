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
  return { ...ruleJsonSchema(DEFINITION_RULE, partial), description: partial ? 'Partial unpublished definition. Omit unknown organizer facts; supplied values must match this contract. Missing decisions prevent publication. Updates replace the definition, so preserve saved facts.' : 'Complete publication definition. scheduling.minimum_rest_minutes is retained for compatibility and never blocks starting or scoring games. Cross-field constraints: min_entries <= max_entries; singles partner_consent false, fixed_doubles true; timestamps must be real dates matching the IANA timezone; closes_at <= starts_at < expected_end_at, with a future close at publication. Supported graph compositions and roster-size constraints are advertised separately; validate_draft is authoritative.' };
}
