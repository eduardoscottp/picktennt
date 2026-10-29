import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { getCapabilities, listModules } from '../../lib/tournament-builder/catalog';
import { TOURNAMENT_TOOLS } from '../../lib/tournament-builder/mcp';
import { validateDraft } from '../../lib/tournament-builder/validate';
import { previewDefinition } from '../../lib/tournament-builder/preview';

export function groupsDefinition() {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  d.schema_version = '2.0';
  d.event.name = 'Four groups of four';
  d.registration.min_entries = d.registration.max_entries = 16;
  d.nodes = [
    { id: 'reg', module: 'registration@1' },
    { id: 'roster', module: 'entries@1', from: 'reg' },
    ...['A', 'B', 'C', 'D'].map((id, group) => ({ id, module: 'round_robin@2', inputs: Array.from({ length: 4 }, (_, i) => ({ kind: 'seed', seed: group * 4 + i + 1 })) })),
    { id: 'SF1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'A', rank: 1 }, { kind: 'rank', node_id: 'B', rank: 1 }] },
    { id: 'SF2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'C', rank: 1 }, { kind: 'rank', node_id: 'D', rank: 1 }] },
    { id: 'F', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'SF1' }, { kind: 'winner', node_id: 'SF2' }] },
    { id: 'result', module: 'placements@2', final: 'F' },
  ];
  return d;
}

test('version 2 graph validates and previews 27 matches rather than a full-roster round robin', () => {
  const d = groupsDefinition(), result = validateDraft(d);
  assert.equal(result.valid, true, JSON.stringify(result));
  const preview = previewDefinition(d, 9);
  assert.equal(preview.maximumMatches, 27);
  assert.ok('estimatedMinutes' in preview && Number(preview.estimatedMinutes) > 0);
});

test('MCP advertises graph definitions and accepts the same graph in its draft tool schema', () => {
  const capabilities = getCapabilities();
  assert.ok('graph' in capabilities);
  for (const id of ['round_robin@2', 'cross_play@1', 'match@1', 'placements@2']) assert.ok(listModules().some(module => module.id === id), id);
  const tool = TOURNAMENT_TOOLS.find(t => t.name === 'create_draft')!;
  const validator = new AjvJsonSchemaValidator().getValidator(tool.inputSchema);
  const result = validator({ operation_id: crypto.randomUUID(), data: { definition: groupsDefinition() } });
  assert.equal(result.valid, true, JSON.stringify(result));
});

test('graph shared rules and unknown fields stay strict', () => {
  const d = groupsDefinition();
  d.event.courts = 9;
  assert.equal(validateDraft(d).valid, false);
  d.event.courts = 4;
  d.nodes[2].inputs[0].code = 'return winner';
  assert.equal(validateDraft(d).valid, false);
});

test('MCP draft schema accepts a cross-play block with ranked advancement', () => {
  const d = groupsDefinition();
  d.registration.min_entries = d.registration.max_entries = 8;
  d.nodes = [
    { id: 'reg', module: 'registration@1' },
    { id: 'roster', module: 'entries@1', from: 'reg' },
    { id: 'cross', module: 'cross_play@1', side_a: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })), side_b: [5, 6, 7, 8].map(seed => ({ kind: 'seed', seed })) },
    { id: 'semi1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'cross', rank: 1 }, { kind: 'rank', node_id: 'cross', rank: 4 }] },
    { id: 'semi2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'cross', rank: 2 }, { kind: 'rank', node_id: 'cross', rank: 3 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'semi1' }, { kind: 'winner', node_id: 'semi2' }] },
    { id: 'result', module: 'placements@2', final: 'final' },
  ];
  assert.equal(validateDraft(d).valid, true);
  const validator = new AjvJsonSchemaValidator().getValidator(TOURNAMENT_TOOLS.find(t => t.name === 'create_draft')!.inputSchema);
  assert.equal(validator({ operation_id: crypto.randomUUID(), data: { definition: d } }).valid, true);
  assert.equal(previewDefinition(d, 9).maximumMatches, 19);
});

test('incomplete version 2 drafts retain supplied decisions and request missing shared facts', () => {
  const result = validateDraft({ schema_version: '2.0', event: { name: 'Groups' } });
  assert.equal(result.errors.length, 0, JSON.stringify(result));
  assert.ok(result.missing_fields.length > 0);
});

test('partial graph nodes and sources request missing fields instead of rejecting a saved draft', () => {
  for (const nodes of [[], [{ id: 'A', module: 'round_robin@2' }], [{ id: 'A', inputs: [{ seed: 1 }, { seed: 2 }] }], [{ id: 'A', module: 'round_robin@2', inputs: [{ seed: 1 }, { kind: 'rank', node_id: 'B' }] }]]) {
    const result = validateDraft({ schema_version: '2.0', nodes });
    assert.equal(result.errors.length, 0, JSON.stringify(result));
    assert.ok(result.missing_fields.length > 0);
  }
});
