import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TournamentDefinition } from '../../lib/tournament-builder/definition';
import { formatSummary } from '../../lib/tournament-builder/format-summary';

const fixture = () => JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as TournamentDefinition;

test('describes configured qualification and placement routes', () => {
  const definition = fixture();
  if (definition.schema_version !== '1.0') throw new Error('Expected v1 fixture');
  const elimination = definition.nodes.find(node => node.module === 'elimination@1');
  const qualification = definition.nodes.find(node => node.module === 'qualify@1');
  if (elimination?.module !== 'elimination@1' || qualification?.module !== 'qualify@1') throw new Error('Expected playoff nodes');
  elimination.config.bronze = true;
  assert.match(formatSummary(definition)!, /1st vs 4th and 2nd vs 3rd/);
  assert.match(formatSummary(definition)!, /losers play for third place/);
  elimination.config.bronze = false;
  assert.match(formatSummary(definition)!, /losers share third place/);
  qualification.config.count = 2;
  assert.match(formatSummary(definition)!, /top two entries advance directly to the final/);
  definition.nodes = definition.nodes.filter(node => !['qualify@1', 'elimination@1'].includes(node.module));
  assert.match(formatSummary(definition)!, /no further rounds/);
});
