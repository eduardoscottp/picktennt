import { MODULE_IDS, type TournamentDefinition, type ValidationIssue, type ValidationOptions, type ValidationResult } from './definition';
import { SUPPORTED_COMPOSITIONS } from './catalog';

import { DEFINITION_RULE, datePattern, nodeRule, ruleJsonSchema, type Rule } from './definition-schema';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateDraft(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const result: ValidationResult = { valid: false, errors: [], warnings: [], missing_fields: [] };
  const issue = (code: ValidationIssue['code'], field_path: string, message: string, node_id?: string) => result.errors.push({ code, field_path, message, ...(node_id ? { node_id } : {}) });
  function parse(value: unknown, rule: Rule, path: string) {
    if (value === undefined) { result.missing_fields.push({ code: 'MISSING_FIELD', field_path: path, message: `Specify ${path}.`, constraints: ruleJsonSchema(rule, false, path), ...(rule.kind === 'enum' ? { allowed_values: [...rule.values] } : {}) }); return; }
    if (rule.kind === 'object') {
      if (!isObject(value)) { issue('UNSUPPORTED_RULE', path, 'Expected an object.'); return; }
      for (const key of Object.keys(value)) if (!Object.hasOwn(rule.fields, key)) issue('UNSUPPORTED_RULE', path ? `${path}.${key}` : key, 'Unknown field.');
      for (const [key, fieldRule] of Object.entries(rule.fields)) parse(value[key], fieldRule, path ? `${path}.${key}` : key);
    } else if (rule.kind === 'array') {
      if (!Array.isArray(value)) { issue('UNSUPPORTED_RULE', path, 'Expected an array.'); return; }
      if ((path !== 'nodes' && value.length < rule.min) || value.length > rule.max) issue('UNSUPPORTED_RULE', path, `Requires ${rule.min}–${rule.max} items.`);
      value.forEach((item, i) => {
        if (path !== 'nodes') { parse(item, rule.item, `${path}[${i}]`); return; }
        if (!isObject(item)) { issue('UNSUPPORTED_RULE', `nodes[${i}]`, 'Expected a node object.'); return; }
        parse(item, nodeRule(item.module, item.config !== undefined), `nodes[${i}]`);
      });
    } else {
      const valid = rule.kind === 'string' ? typeof value === 'string' && value.trim().length > 0 && value === value.trim() && value.length <= rule.max && (!rule.pattern || rule.pattern.test(value))
        : rule.kind === 'integer' ? typeof value === 'number' && Number.isInteger(value) && value >= rule.min && value <= rule.max
        : rule.kind === 'boolean' ? typeof value === 'boolean' : rule.values.includes(value);
      if (!valid) {
        const constraints = ruleJsonSchema(rule, false, path);
        const message = rule.kind === 'enum' ? `Allowed values: ${rule.values.map(value => JSON.stringify(value)).join(', ')}.` : rule.kind === 'integer' ? `Expected an integer from ${rule.min} to ${rule.max}.` : rule.kind === 'boolean' ? 'Expected true or false.' : `Expected nonempty trimmed text, maximum ${rule.max} characters${rule.pattern ? `, matching ${rule.pattern.source}` : ''}.`;
        result.errors.push({ code: path.endsWith('.module') ? 'UNSUPPORTED_MODULE' : path.endsWith('.config.count') ? 'INVALID_ADVANCEMENT' : 'UNSUPPORTED_RULE', field_path: path, message, constraints, ...(rule.kind === 'enum' ? { allowed_values: [...rule.values] } : {}) });
      }
    }
  }
  parse(input, DEFINITION_RULE, '');
  if (!isObject(input)) return result;
  // Cross-field checks run only on supplied values, preserving useful incomplete drafts.
  const event = isObject(input.event) ? input.event : {};
  const registration = isObject(input.registration) ? input.registration : {};
  const policies = isObject(input.policies) ? input.policies : {};
  const ranking = isObject(policies.ranking) ? policies.ranking : {};
  if (Array.isArray(ranking.order) && (ranking.order[0] !== 'wins_desc' || new Set(ranking.order).size !== ranking.order.length)) issue('UNSUPPORTED_RULE', 'policies.ranking.order', 'Wins must be first; ranking keys must be unique.');
  if (typeof registration.min_entries === 'number' && typeof registration.max_entries === 'number' && registration.min_entries > registration.max_entries) issue('INVALID_CAPACITY', 'registration.min_entries', 'Minimum entries exceeds capacity.');
  if (typeof registration.partner_consent === 'boolean' && ['singles', 'fixed_doubles'].includes(String(registration.entry_type)) && registration.partner_consent !== (registration.entry_type === 'fixed_doubles')) issue('UNSUPPORTED_RULE', 'registration.partner_consent', 'Consent must be true for fixed doubles and false for singles.');

  let timezoneValid = false;
  if (typeof event.timezone === 'string') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: event.timezone }).format(0); timezoneValid = !/^[+-]/.test(event.timezone); }
    catch { /* Report unsupported IANA zone below. */ }
    if (!timezoneValid) issue('UNSUPPORTED_RULE', 'event.timezone', 'Specify a valid IANA timezone.');
  }
  const instants: Record<string, number> = {};
  for (const [path, value] of [['event.starts_at', event.starts_at], ['event.expected_end_at', event.expected_end_at], ['registration.closes_at', registration.closes_at]] as const) {
    if (typeof value !== 'string' || !datePattern.test(value)) continue;
    const instant = Date.parse(value);
    // Date.parse normalizes impossible dates such as February 30; compare the original local components.
    const offset = value.endsWith('Z') ? 0 : (value.at(-6) === '-' ? -1 : 1) * (Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2)));
    const local = new Date(instant + offset * 60_000);
    if (!Number.isFinite(instant) || !Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== value.slice(0, 19)) { issue('UNSUPPORTED_RULE', path, 'Invalid calendar date or offset.'); continue; }
    instants[path] = instant;
    if (timezoneValid) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: String(event.timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
      if (`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}` !== value.slice(0, 19)) issue('RESOURCE_CONFLICT', path, 'Timestamp offset disagrees with the event timezone.');
    }
  }
  if (instants['event.expected_end_at'] <= instants['event.starts_at']) issue('RESOURCE_CONFLICT', 'event.expected_end_at', 'Expected end must follow start.');
  if (instants['registration.closes_at'] > instants['event.starts_at']) issue('RESOURCE_CONFLICT', 'registration.closes_at', 'Registration must close no later than event start.');
  if (options.publication && instants['registration.closes_at'] <= (options.now ?? new Date()).getTime()) issue('RESOURCE_CONFLICT', 'registration.closes_at', 'Registration deadline must be in the future at publication.');

  if (Array.isArray(input.nodes)) {
    const nodes = input.nodes.filter(isObject);
    const ids = new Set<unknown>();
    nodes.forEach((node, i) => {
      if (ids.has(node.id)) issue('INCOMPATIBLE_CONNECTION', `nodes[${i}].id`, 'Node IDs must be unique.', String(node.id));
      ids.add(node.id);
      if ((i === 0 && node.from !== undefined) || (i > 0 && node.from !== undefined && node.from !== nodes[i - 1].id)) issue('INCOMPATIBLE_CONNECTION', `nodes[${i}].from`, 'Each node must reference exactly its preceding node.', String(node.id));
    });
    const completeModules = nodes.length === input.nodes.length && nodes.every(n => MODULE_IDS.includes(n.module as typeof MODULE_IDS[number]));
    if (completeModules) {
      const compatible = SUPPORTED_COMPOSITIONS.filter(path => nodes.length <= path.length && nodes.every((node, i) => node.module === path[i]));
      if (!compatible.length) issue('INCOMPATIBLE_CONNECTION', 'nodes', 'Use one of the three supported complete compositions.');
      else if (!compatible.some(path => path.length === nodes.length)) result.missing_fields.push({ code: 'MISSING_FIELD', field_path: 'nodes', message: 'Complete a supported composition through placements.' });
    }
    const qualify = nodes.find(n => n.module === 'qualify@1');
    const elimination = nodes.find(n => n.module === 'elimination@1');
    const qualifierCount = isObject(qualify?.config) ? qualify.config.count : undefined;
    const bracket = isObject(elimination?.config) ? elimination.config : {};
    if (elimination && bracket.seeding !== undefined && bracket.seeding !== (qualify ? 'ranked' : 'draw')) issue('INCOMPATIBLE_CONNECTION', `nodes[${nodes.indexOf(elimination)}].config.seeding`, 'Direct brackets require draw; qualified brackets require ranked seeding.', String(elimination.id));
    if (typeof qualifierCount === 'number' && typeof registration.max_entries === 'number' && qualifierCount > registration.max_entries) issue('INVALID_ADVANCEMENT', 'registration.max_entries', 'Capacity cannot supply the requested qualifier count.');
    if (elimination && !qualify && typeof registration.min_entries === 'number' && typeof registration.max_entries === 'number' && ![2, 4, 8, 16].some(n => n >= Number(registration.min_entries) && n <= Number(registration.max_entries) && (bracket.bronze !== true || n >= 4))) issue('INVALID_CAPACITY', 'registration.max_entries', 'No supported direct bracket size exists within this entry range and bronze policy.');
    if (bracket.bronze === true && (qualifierCount === 2 || (!qualify && registration.max_entries === 2))) issue('UNSUPPORTED_RULE', `nodes[${nodes.indexOf(elimination!)}].config.bronze`, 'Two-entry brackets have no semifinal losers for bronze.');
  }
  result.valid = result.errors.length === 0 && result.missing_fields.length === 0;
  if (result.valid) {
    result.definition = structuredClone(input) as unknown as TournamentDefinition;
    const d = result.definition;
    const rr = d.nodes.some(n => n.module === 'round_robin@1');
    const q = d.nodes.find(n => n.module === 'qualify@1');
    const elimination = d.nodes.find(n => n.module === 'elimination@1');
    const n = d.registration.max_entries;
    const bracketN = q?.module === 'qualify@1' ? q.config.count : n;
    const matches = (rr ? n * (n - 1) / 2 : 0) + (elimination ? bracketN - 1 + (elimination.config.bronze ? 1 : 0) : 0);
    const estimate = Math.ceil(matches / d.event.courts) * d.scheduling.estimated_slot_minutes + d.scheduling.contingency_minutes;
    if (estimate > (instants['event.expected_end_at'] - instants['event.starts_at']) / 60_000) result.warnings.push({ code: 'INSUFFICIENT_TIME', field_path: 'event.expected_end_at', message: `Even the estimated court workload (${estimate} minutes) exceeds the venue window. Dependencies and match overruns may add time.` });
  }
  return result;
}
export const validateDefinition = validateDraft;

