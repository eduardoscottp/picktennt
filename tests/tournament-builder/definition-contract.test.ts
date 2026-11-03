import assert from 'node:assert/strict';
import test from 'node:test';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import { getCapabilities } from '../../lib/tournament-builder/catalog';
import { TOURNAMENT_TOOLS } from '../../lib/tournament-builder/mcp';
import { validateDraft, validateDefinition } from '../../lib/tournament-builder/validate';

type Schema = { type?: string; properties?: Record<string, Schema>; enum?: unknown[]; required?: string[]; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; items?: Schema; oneOf?: Schema[]; anyOf?: Schema[]; additionalProperties?: boolean };
const advertised = () => getCapabilities() as unknown as { definition_schema: Schema; draft_definition_schema: Schema; compositions: string[][]; participant_enrollment: { ai_can_enroll: boolean; instructions: string } };
const child = (schema: Schema, path: string) => path.split('.').reduce((value, key) => value.properties![key], schema);
function fromContract(compositionIndex = 0) {
  const capabilities = advertised();
  const facts: Record<string, unknown> = { 'event.name': 'Contract acceptance', 'event.starts_at': '2030-01-01T10:00:00Z', 'event.expected_end_at': '2030-01-01T20:00:00Z', 'event.timezone': 'UTC', 'event.venue_name': 'Organizer supplied venue', 'registration.closes_at': '2030-01-01T09:00:00Z' };
  function choose(schema: Schema, path = ''): unknown {
    if (Object.hasOwn(facts, path)) return facts[path];
    if (schema.enum) return schema.enum[0];
    if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => schema.required!.includes(key)).map(([key, value]) => [key, choose(value, path ? `${path}.${key}` : key)]));
    if (schema.type === 'integer') return schema.minimum;
    if (schema.type === 'boolean') return false;
    if (path === 'nodes') return capabilities.compositions[compositionIndex].map((module, i) => {
      const nodeSchema = schema.items!.oneOf!.find(variant => variant.properties!.module.enum![0] === module)!;
      const config = nodeSchema.required!.includes('config') ? choose(nodeSchema.properties!.config, 'config') as Record<string, unknown> : undefined;
      if (config && Object.hasOwn(config, 'seeding')) config.seeding = nodeSchema.properties!.config.properties!.seeding.enum![capabilities.compositions[compositionIndex].includes('qualify@1') ? 1 : 0];
      return { id: `n${i}`, module, ...(i ? { from: `n${i - 1}` } : {}), ...(config ? { config } : {}) };
    });
    if (schema.type === 'array') return [choose(schema.items!, path)];
    throw new Error(`Missing organizer fact ${path}`);
  }
  return choose(capabilities.definition_schema) as Record<string, unknown>;
}
test('advertised contract alone constructs a complete valid definition without private fixtures', () => {
  for (let i = 0; i < advertised().compositions.length; i++) {
    const result = validateDefinition(fromContract(i));
    assert.equal(result.valid, true, JSON.stringify(result));
  }
  assert.deepEqual(child(advertised().definition_schema, 'policies.confirmation').enum, ['opponent_or_admin_v1']);
  assert.deepEqual(child(advertised().definition_schema, 'policies.correction').enum, ['impact_review_void_and_replay_v1']);
  assert.equal(child(advertised().definition_schema, 'event.courts').maximum, 8);
  assert.equal(child(advertised().definition_schema, 'registration.max_entries').maximum, 16);
});
test('draft tool schemas expose vocabulary while allowing missing decisions and rejecting unknown keys', () => {
  for (const name of ['create_draft', 'update_draft']) {
    const schema = child(TOURNAMENT_TOOLS.find(tool => tool.name === name)!.inputSchema as Schema, 'data.definition');
    assert.deepEqual(schema, advertised().draft_definition_schema);
    assert.deepEqual(schema.required, []);
    assert.deepEqual(child(schema, 'policies.ranking').required, []);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(child(schema, 'policies.ranking.final_tie').enum, ['recorded_draw']);
    assert.equal(child(schema, 'nodes').minItems, 0);
  }
  assert.equal(validateDraft({ event: { name: 'Still deciding' } }).errors.length, 0);
  assert.equal(validateDraft({ participants: ['invented'] }).errors.length, 1);
  assert.equal(advertised().participant_enrollment.ai_can_enroll, false);
  assert.match(advertised().participant_enrollment.instructions, /website.*consent/i);
});
test('invalid enum values and missing decisions return exact machine-readable choices', () => {
  const result = validateDraft({ policies: { confirmation: 'automatic', ranking: { final_tie: 'random' } } });
  const errors = JSON.parse(JSON.stringify(result.errors)) as { field_path: string; allowed_values?: unknown[]; message: string }[];
  assert.deepEqual(errors.find(error => error.field_path === 'policies.confirmation')?.allowed_values, ['opponent_or_admin_v1']);
  assert.match(errors.find(error => error.field_path === 'policies.confirmation')!.message, /opponent_or_admin_v1/);
  const missing = JSON.parse(JSON.stringify(result.missing_fields)) as { field_path: string; constraints?: Schema }[];
  assert.deepEqual(missing.find(issue => issue.field_path === 'policies.correction')?.constraints?.enum, ['impact_review_void_and_replay_v1']);
  assert.deepEqual(missing.find(issue => issue.field_path === 'policies.ranking.order')?.constraints?.items?.enum, child(advertised().definition_schema, 'policies.ranking.order').items!.enum);
});
test('standard MCP JSON Schema validation accepts partial nodes and rejects unsupported supplied values', () => {
  const validator = new AjvJsonSchemaValidator();
  const complete = validator.getValidator(advertised().definition_schema as JsonSchemaType);
  const partial = validator.getValidator(advertised().draft_definition_schema as JsonSchemaType);
  for (let i = 0; i < advertised().compositions.length; i++) assert.equal(complete(fromContract(i)).valid, true);
  assert.equal(complete({ event: { name: 'Undecided' } }).valid, false);
  for (const draft of [{}, { policies: { ranking: {} } }, { nodes: [] }, { nodes: [{}] }, { nodes: [{ module: 'elimination@1', config: { bronze: true } }] }]) assert.equal(partial(draft).valid, true, JSON.stringify(draft));
  for (const draft of [{ event: { courts: 9 } }, { registration: { max_entries: 17 } }, { policies: { confirmation: 'automatic' } }, { policies: { ranking: { order: ['invented'] } } }, { nodes: [{ module: 'qualify@1', config: { count: 3 } }] }, { nodes: [{ module: 'registration@1', config: { participants: ['invented'] } }] }, { players: [] }]) assert.equal(partial(draft).valid, false, JSON.stringify(draft));
});
