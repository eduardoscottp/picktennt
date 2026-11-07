import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeReplan } from '../../lib/tournament-builder/replan-analysis';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';
import { callTournamentTool, type McpDependencies } from '../../lib/tournament-builder/mcp';

const seed = (seed: number) => ({ kind: 'seed', seed });
const nodes = [
  { id: 'reg', module: 'registration@1' }, { id: 'roster', module: 'entries@1', from: 'reg' },
  { id: 'left', module: 'match@1', inputs: [seed(1), seed(2)] },
  { id: 'right', module: 'match@1', inputs: [seed(3), seed(4)] },
  { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'left' }, { kind: 'winner', node_id: 'right' }] },
  { id: 'placement', module: 'placements@2', final: 'final' },
];
const definition = { ...JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')), schema_version: '2.0', nodes };
definition.registration.max_entries = 4;
const admin = { id: 'owner', clientId: 'mcp', role: 'owner' as const, permissions: ['admin:manage'] };
function snapshot(): CommandSnapshot {
  return { event: { id: 'event', created_by: 'owner', revision: 7, modular_state: 'active', definition_id: 'def' }, definitions: [{ id: 'def', definition }], teams: [], team_members: [], tournament_players: [], rounds: [], standings: [], stages: nodes.map((node, index) => ({ id: `s${index}`, node_id: node.id, module_id: node.module.split('@')[0] })), matches: [
    { id: 'left-match', stage_id: 's2', status: 'validated', outcome_kind: 'played', score_a: 11, score_b: 7, started_at: '2026-11-06T12:00:00Z' },
    { id: 'right-match', stage_id: 's3', status: 'validated', outcome_kind: 'played', score_a: 11, score_b: 9 },
    { id: 'final-match', stage_id: 's4', status: 'scheduled' },
  ] };
}
test('graph analysis follows changed connections through later stages without mutating scores', () => {
  const s = snapshot(), before = JSON.stringify(s);
  const modified = structuredClone(nodes);
  modified[2] = { id: 'left', module: 'match@1', inputs: [seed(2), seed(1)] };
  const review = analyzeReplan(s, admin, { nodes: modified });
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(review.changed_node_ids, ['left']);
  assert.deepEqual(review.affected_node_ids, ['final', 'left', 'placement']);
  assert.deepEqual(review.affected_matches.map(match => match.id), ['left-match', 'final-match']);
  assert.deepEqual(review.unaffected_matches.map(match => match.id), ['right-match']);
  assert.equal(review.dupr_history_unknown, true);
  assert.equal(review.executable, false);
  const visible = publicMcpResult('admin_analyze_replan', review) as typeof review;
  assert.deepEqual(visible.proposed_nodes, modified);
  assert.equal(visible.analysis_only, true);
  s.stages.find(stage => stage.node_id === 'final')!.output = { manualMatchEntries: { a: 'team-a', b: 'team-b', private_note: 'secret' } };
  const withManual = publicMcpResult('admin_analyze_replan', analyzeReplan(s, admin, { nodes: modified })) as typeof review;
  assert.deepEqual(withManual.current_manual_match_entries, [{ node_id: 'final', team_a_id: 'team-a', team_b_id: 'team-b' }]);
  assert.doesNotMatch(JSON.stringify(withManual), /secret/);
  const tournament = publicMcpResult('admin_get_tournament', s) as { stages: { node_id: string; manual_match_entries?: unknown }[] };
  assert.deepEqual(tournament.stages.find(stage => stage.node_id === 'final')?.manual_match_entries, { a: 'team-a', b: 'team-b' });
  assert.doesNotMatch(JSON.stringify(tournament), /secret/);
});
test('analysis rejects invalid graphs and non-administrators and requires owner reopening after completion', () => {
  const s = snapshot();
  assert.throws(() => analyzeReplan(s, { ...admin, id: 'other', role: 'player' }, { nodes }), { code: 'FORBIDDEN' });
  assert.throws(() => analyzeReplan(s, { ...admin, permissions: [] }, { nodes }), { code: 'FORBIDDEN' });
  const invalid = structuredClone(nodes);
  invalid[2] = { id: 'left', module: 'match@1', inputs: [seed(1), seed(1)] };
  assert.throws(() => analyzeReplan(s, admin, { nodes: invalid }), { code: 'INVALID_DEFINITION' });
  s.event!.modular_state = 'completed';
  assert.equal(analyzeReplan(s, admin, { nodes }).requires_owner_reopen, true);
});
test('MCP exposes structural analysis as a read-only admin operation', async () => {
  let writes = 0;
  const id = 'b27c31ec-0c66-4bf6-94c4-708432cd11a0', s = snapshot();
  s.event!.id = id;
  const deps: McpDependencies = { execute: async () => { writes++; return {}; }, getDraft: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}), admin: { snapshot: async () => s, findPlayer: async () => ({}), previewCorrection: async () => ({}), previewWithdrawal: async () => ({}), analyzeReplan: async (_id, input) => analyzeReplan(s, admin, input) } };
  const review = await callTournamentTool('admin_analyze_replan', { tournament_id: id, data: { nodes } }, deps) as { analysis_only: boolean; executable: boolean };
  assert.equal(review.analysis_only, true);
  assert.equal(review.executable, false);
  assert.equal(writes, 0);
  await assert.rejects(callTournamentTool('admin_analyze_replan', { tournament_id: id, data: { nodes, actor_id: id } }, deps), { code: 'INVALID_REQUEST' });
  await assert.rejects(callTournamentTool('admin_analyze_replan', { tournament_id: id, data: { nodes } }, { ...deps, admin: undefined }), { code: 'INVALID_REQUEST' });
});
