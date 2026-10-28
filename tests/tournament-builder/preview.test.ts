import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewDefinition } from '../../lib/tournament-builder/preview';
const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));

test('review shows rules, full fixture count and binds the reviewed definition', () => {
  const preview = previewDefinition(definition, 7);
  assert.equal(preview.valid, true);
  assert.equal(preview.revision, 7);
  assert.equal(preview.maximumMatches, 31);
  assert.equal(preview.definitionHash?.length, 64);
  assert.equal(preview.entryType, 'fixed_doubles');
  assert.equal(preview.thirdPlace, 'shared');
  assert.equal(preview.moduleNames?.length, 7);
});

test('incomplete definitions request missing facts without fabricated event details', () => {
  const preview = previewDefinition({ event: { name: 'Saturday' } }, 1);
  assert.equal(preview.valid, false);
  assert.ok(preview.missing_fields.length);
  assert.equal(preview.maximumMatches, undefined);
  assert.equal(preview.definitionHash, undefined);
});

