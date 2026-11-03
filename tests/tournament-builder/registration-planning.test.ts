import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { validateDraft } from '../../lib/tournament-builder/validate';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import { resolvedDefinition } from '../../lib/tournament-builder/resolved-definition';
import { previewCorrection } from '../../lib/tournament-builder/corrections';
import { callTournamentTool } from '../../lib/tournament-builder/mcp';
import { ADMIN_TOOLS } from '../../lib/tournament-builder/mcp-admin';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const owner = { id: randomUUID(), clientId: 'web' };
const context = { now: '2026-10-28T16:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
const definition = (): GraphDefinition => {
  const d = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
  d.registration.min_entries = 8;
  return d;
};
function execute(s: CommandSnapshot, command: string, data: Record<string, unknown> = {}, actor = owner) {
  const { effects } = planCommand(s, actor, command, data, context);
  const next = structuredClone(s);
  next.event = { id: next.event?.id ?? randomUUID(), created_by: owner.id, revision: 0, roster_revision: 0, ...next.event, ...effects.event };
  next.event.revision = Number(next.event.revision) + 1;
  if (effects.definition) {
    const old = next.definitions.find(row => row.id === effects.definition!.id);
    if (old) Object.assign(old, effects.definition); else next.definitions.push(effects.definition);
  }
  for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) for (const patch of effects[table] ?? []) {
    const old = next[table].find(row => row.id === patch.id);
    if (old) Object.assign(old, patch); else next[table].push(patch);
  }
  return next;
}
function published(d: GraphDefinition) {
  let s: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  s = execute(s, 'createDraft', { definition: d });
  const review = previewDefinition(d, 1);
  return execute(s, 'publishTournament', { reviewed_definition_hash: review.definitionHash, acknowledged_warning_codes: review.warningCodes });
}
function registered(d: GraphDefinition, count = 10) {
  let s = published(d);
  for (let i = 0; i < count; i++) {
    const players = [randomUUID(), randomUUID()];
    for (const userId of players) s = execute(s, 'joinTournament', { definition_id: s.event!.definition_id, consent: true }, { id: userId, clientId: 'web' });
    s = execute(s, 'addRegisteredEntry', { definition_id: s.event!.definition_id, player_ids: players, entry_name: `Pair ${i}`, reason: 'Admin placed joined players' });
  }
  return execute(s, 'closeRegistration');
}
function assignments(s: CommandSnapshot) {
  return { A: s.teams.slice(0, 3).map(t => t.id), B: s.teams.slice(3, 6).map(t => t.id), C: s.teams.slice(6, 8).map(t => t.id), D: s.teams.slice(8, 10).map(t => t.id) };
}

test('an incomplete graph saves scheduling without inventing missing nodes', () => {
  const d = definition();
  d.nodes = d.nodes.filter(n => n.module === 'round_robin@2');
  d.scheduling = { estimated_slot_minutes: 30, minimum_rest_minutes: 10, contingency_minutes: 30 };
  const result = validateDraft(d);
  assert.deepEqual(result.errors, []);
  assert.ok(result.missing_fields.length);
  let s: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  s = execute(s, 'createDraft', { definition: d });
  s = execute(s, 'updateDraft', { definition: d });
  assert.deepEqual((s.definitions[0].definition as GraphDefinition).scheduling, d.scheduling);
  assert.equal((s.definitions[0].definition as GraphDefinition).nodes.length, 4);
});

test('registration opens without players or a finished knockout; generation requires completion', () => {
  const d = definition();
  d.nodes = d.nodes.filter(n => ['registration@1', 'entries@1', 'round_robin@2'].includes(n.module));
  const s = published(d);
  assert.equal(s.event!.modular_state, 'registration_open');
  assert.equal(s.teams.length, 0);
  assert.equal(s.matches.length, 0);
  assert.equal(previewDefinition(d, 1).generationReady, false);
  const closed = registered(d);
  assert.throws(() => execute(closed, 'lockRoster', { reviewed_roster_revision: closed.event!.roster_revision, group_assignments: assignments(closed) }), /complete|pending|graph/i);
  const locked = execute(closed, 'lockRoster', { reviewed_roster_revision: closed.event!.roster_revision, group_assignments: assignments(closed), nodes: definition().nodes });
  assert.equal(locked.event!.modular_state, 'ready');
  assert.equal(locked.matches.length, 11);
  assert.deepEqual((locked.definitions[0].definition as GraphDefinition).nodes, d.nodes, 'Published plan remains immutable');
  assert.deepEqual((resolvedDefinition(locked)!.definition as GraphDefinition).nodes, definition().nodes);
  assert.equal(previewDefinition(resolvedDefinition(locked)!.definition, 1).generationReady, true);
});

test('underfilled group assignments generate occupied games only and complete through the final', () => {
  const s = registered(definition());
  assert.equal(s.matches.length, 0);
  const data = { reviewed_roster_revision: s.event!.roster_revision, group_assignments: assignments(s) };
  let locked = execute(s, 'lockRoster', data);
  assert.equal(locked.teams.length, 10);
  assert.equal(locked.matches.length, 11); // 3+3+1+1 group games, two semis and final.
  assert.equal(locked.matches.filter(m => m.team_a_id && m.team_b_id).length, 8);
  locked = execute(locked, 'startTournament');
  for (let i = 0; i < 11; i++) {
    const match = locked.matches.find(m => m.status === 'scheduled' && m.team_a_id && m.team_b_id);
    assert.ok(match);
    const a = Number(locked.teams.find(t => t.id === match.team_a_id)!.seed), b = Number(locked.teams.find(t => t.id === match.team_b_id)!.seed);
    locked = execute(locked, 'attestScore', { match_id: match.id, score_a: a < b ? 11 : 0, score_b: a < b ? 0 : 11, reason: 'Confirmed final score' });
    if (i === 0) assert.ok(previewCorrection(locked, owner, { match_id: match.id, score_a: 0, score_b: 11 }).preview_hash);
  }
  assert.equal(locked.event!.modular_state, 'completed');
  assert.equal(locked.standings.length, 10);
  assert.throws(() => execute(locked, 'lockRoster', data));
});

test('assignments reject duplicates, outsiders, singleton groups, omissions and stale roster review', () => {
  const s = registered(definition()), groups = assignments(s);
  const lock = (group_assignments: unknown, revision = s.event!.roster_revision) => execute(s, 'lockRoster', { reviewed_roster_revision: revision, group_assignments });
  assert.throws(() => lock({ ...groups, D: groups.C }));
  assert.throws(() => lock({ ...groups, D: [randomUUID(), groups.D[1]] }));
  assert.throws(() => lock({ ...groups, A: groups.A.slice(0, 1) }));
  assert.throws(() => lock({ ...groups, D: [] }));
  assert.throws(() => lock(groups, 0));
  assert.throws(() => execute(s, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision }));
  const changed = definition().nodes;
  changed.find(n => n.module === 'match@1')!.id = 'changed';
  assert.throws(() => execute(s, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision, group_assignments: groups, nodes: changed }));
});

test('MCP accepts reviewed actual groups and enforces confirmation before forwarding generation', async () => {
  const s = registered(definition());
  const data = { reviewed_roster_revision: s.event!.roster_revision, group_assignments: assignments(s) };
  const args = { tournament_id: s.event!.id, operation_id: randomUUID(), expected_revision: s.event!.revision, data, confirmed_structure_change: true };
  const tool = ADMIN_TOOLS.find(t => t.name === 'admin_lock_roster')!;
  assert.equal(new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args).valid, true);
  let calls = 0;
  const deps = {
    execute: async (command: string, tournamentId: string | null, input: unknown) => {
      calls++;
      assert.equal(tournamentId, s.event!.id);
      const envelope = input as { data: Record<string, unknown> };
      return planCommand(s, { ...owner, clientId: 'claude', permissions: ['admin:manage'] }, command, envelope.data, context);
    },
    getDraft: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}),
    admin: { snapshot: async () => s, findPlayer: async () => ({}), previewCorrection: async () => ({}), previewWithdrawal: async () => ({}) },
  };
  await assert.rejects(callTournamentTool('admin_lock_roster', { ...args, confirmed_structure_change: false }, deps), { code: 'CONFIRMATION_REQUIRED' });
  assert.equal(calls, 0);
  const plan = await callTournamentTool('admin_lock_roster', args, deps) as ReturnType<typeof planCommand>;
  assert.equal(plan.effects.matches?.length, 11);
  assert.equal(calls, 1);
});
