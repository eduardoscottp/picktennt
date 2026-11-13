import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_TOOLS, callAdminTool, type AdminMcpDependencies } from '../../lib/tournament-builder/mcp-admin';
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';
import { confirmationQuestion } from '../../lib/tournament-builder/mcp-confirmation';

const event = '00000000-0000-4000-8000-000000000001';
const operation = '00000000-0000-4000-8000-000000000002';

test('MCP requires explicit confirmation and forwards the reviewed command', async () => {
  const review = { state: 'ready', event_revision: 3, preview_hash: 'a'.repeat(64), fixtures: [] };
  const admin = { previewNextStage: async () => review } as unknown as AdminMcpDependencies;
  assert.ok(ADMIN_TOOLS.some(tool => tool.name === 'admin_preview_next_stage'));
  assert.ok(ADMIN_TOOLS.some(tool => tool.name === 'admin_generate_next_stage'));
  assert.deepEqual(await callAdminTool('admin_preview_next_stage', { tournament_id: event }, admin, async () => ({})), review);
  const args = { tournament_id: event, operation_id: operation, expected_revision: 3, data: { preview_hash: review.preview_hash } };
  let calls = 0;
  const execute = async (command: string, id: string, input: unknown) => { calls++; assert.equal(command, 'generateNextStage'); assert.equal(id, event); return input; };
  await assert.rejects(callAdminTool('admin_generate_next_stage', args, admin, execute), { code: 'CONFIRMATION_REQUIRED' });
  await callAdminTool('admin_generate_next_stage', { ...args, confirmed_structure_change: true }, admin, execute);
  assert.equal(calls, 1);
  assert.equal(confirmationQuestion('admin_preview_next_stage', { state: 'blocked' }), undefined);
  assert.match(confirmationQuestion('admin_preview_next_stage', review)!, /Generate the reviewed next stage/);
  assert.match(confirmationQuestion('admin_preview_next_stage', { ...review, fixtures: [{ automatic_outcome: 'walkover' }] })!, /automatic walkovers or no-contests/);
  assert.match(confirmationQuestion('admin_preview_next_stage', { ...review, no_eligible_champion: true })!, /No eligible champion.*final placements will remain blocked/);
});

test('MCP review exposes only the permitted stage fields', () => {
  const projected = publicMcpResult('admin_preview_next_stage', { state: 'ready', preview_hash: 'hash', no_eligible_champion: true, private_data: 'secret', fixtures: [{ id: 'one', bronze: true, a: { kind: 'entry', entryId: 'a', private_data: 'secret' }, b: { kind: 'loser', fixtureId: 'two' } }] }) as Record<string, unknown>;
  assert.equal('private_data' in projected, false);
  assert.equal(projected.no_eligible_champion, true);
  assert.deepEqual(projected.fixtures, [{ id: 'one', bronze: true, a: { kind: 'entry', entryId: 'a' }, b: { kind: 'loser', fixtureId: 'two' } }]);
});

test('MCP graph review preserves declared sources without private fields', () => {
  const result = publicMcpResult('admin_preview_next_stage', { state: 'ready', preview_hash: 'hash', fixtures: [{ id: 'final:match', stage_id: 'final', kind: 'final', team_a_id: 'withdrawn', side_a_eligible: false, side_b_eligible: true, side_sources: [{ kind: 'winner', node_id: 'semi', private_data: 'secret' }, { kind: 'rank', node_id: 'pool', rank: 2 }], sources: [{ kind: 'seed', seed: 1 }], hidden: 'secret' }] }) as { fixtures: Record<string, unknown>[] };
  assert.deepEqual(result.fixtures[0].side_sources, [{ kind: 'winner', node_id: 'semi' }, { kind: 'rank', node_id: 'pool', rank: 2 }]);
  assert.equal(result.fixtures[0].side_a_eligible, false);
  assert.equal(result.fixtures[0].side_b_eligible, true);
  assert.equal('hidden' in result.fixtures[0], false);
});

test('MCP review preserves vacant slots and automatic outcomes without inventing scores or leaking extra data', () => {
  const value = { state: 'ready', preview_hash: 'hash', fixtures: [
    { id: 'semifinal', stageId: 'playoff', resolved_entry_a: 'a', resolved_entry_b: null, automatic_outcome: 'walkover', automatic_winner_entry_id: 'a', score_a: 11, secret: 'private' },
    { id: 'empty', stageId: 'playoff', resolved_entry_a: null, resolved_entry_b: null, automatic_outcome: 'no_contest', automatic_winner_entry_id: null, score_b: 0 },
    { id: 'final', stageId: 'playoff', resolved_entry_a: 'a', resolved_entry_b: null, automatic_outcome: null, automatic_winner_entry_id: null },
  ] };
  const projected = publicMcpResult('admin_preview_next_stage', value) as { fixtures: Record<string, unknown>[] };
  assert.deepEqual(projected.fixtures, [
    { id: 'semifinal', stageId: 'playoff', resolved_entry_a: 'a', resolved_entry_b: null, automatic_outcome: 'walkover', automatic_winner_entry_id: 'a' },
    { id: 'empty', stageId: 'playoff', resolved_entry_a: null, resolved_entry_b: null, automatic_outcome: 'no_contest', automatic_winner_entry_id: null },
    { id: 'final', stageId: 'playoff', resolved_entry_a: 'a', resolved_entry_b: null, automatic_outcome: null, automatic_winner_entry_id: null },
  ]);
});
