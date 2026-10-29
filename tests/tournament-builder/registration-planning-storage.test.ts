import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { resolvedDefinition } from '../../lib/tournament-builder/resolved-definition';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

test('SQL preserves the published registration plan and persists underfilled assignments and completed fixtures atomically', async () => {
  const db = await storageDatabase();
  try {
    const event = randomUUID(), actor = { id: owner, clientId: 'web' };
    const context = { now: '2026-10-28T16:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
    const full: GraphDefinition = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
    full.registration.min_entries = 8;
    const d = { ...full, nodes: full.nodes.filter(n => ['registration@1', 'entries@1', 'round_robin@2'].includes(n.module)) };
    let current: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
    const snapshot = async () => role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
    const apply = async (name: string, data: Record<string, unknown>) => {
      const plan = planCommand(current, actor, name, data, context);
      await command(db, { event, command: name, revision: current.event ? Number(current.event.revision) : null, request: data, effects: plan.effects, result: plan.result });
      current = await snapshot();
    };
    await apply('createDraft', { definition: d });
    const review = previewDefinition(d, 1);
    await apply('publishTournament', { reviewed_definition_hash: review.definitionHash, acknowledged_warning_codes: review.warningCodes });
    assert.equal(current.matches.length, 0);
    const published = structuredClone(current.definitions[0]);
    for (let i = 0; i < 10; i++) {
      const players = [randomUUID(), randomUUID()];
      for (const player of players) await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [player, `${player}@example.invalid`, JSON.stringify({ given_name: 'Registered player' })]);
      await apply('addRegisteredEntry', { definition_id: current.event!.definition_id, player_ids: players, entry_name: `Pair ${i}`, reason: 'Admin enrollment of existing profiles' });
    }
    await apply('closeRegistration', {});
    const groups = { A: current.teams.slice(0, 3).map(t => t.id), B: current.teams.slice(3, 6).map(t => t.id), C: current.teams.slice(6, 8).map(t => t.id), D: current.teams.slice(8, 10).map(t => t.id) };
    const stale = structuredClone(current);
    const data = { reviewed_roster_revision: current.event!.roster_revision, nodes: full.nodes, group_assignments: groups };
    const stalePlan = planCommand(stale, actor, 'lockRoster', data, context);
    await apply('lockRoster', data);
    assert.equal(current.matches.length, 11);
    assert.deepEqual(current.definitions[0], published);
    assert.equal((resolvedDefinition(current)!.definition as GraphDefinition).nodes.length, full.nodes.length);
    assert.equal(Object.keys((current.stages.find(s => s.module_id === 'entries')!.output as { seedAssignments: object }).seedAssignments).length, 10);
    const before = structuredClone(current);
    await assert.rejects(command(db, { event, command: 'lockRoster', revision: Number(stale.event!.revision), request: data, effects: stalePlan.effects, result: stalePlan.result }), /STALE_REVISION/);
    assert.deepEqual(await snapshot(), before);
    await apply('startTournament', {});
    for (let i = 0; i < 11; i++) {
      const m = current.matches.find(m => m.status === 'scheduled' && m.team_a_id && m.team_b_id)!;
      assert.ok(m);
      const a = Number(current.teams.find(t => t.id === m.team_a_id)!.seed), b = Number(current.teams.find(t => t.id === m.team_b_id)!.seed);
      await apply('attestScore', { match_id: m.id, score_a: a < b ? 11 : 0, score_b: a < b ? 0 : 11, reason: 'Confirmed final result' });
    }
    assert.equal(current.event!.modular_state, 'completed');
    assert.equal(current.standings.length, 10);
  } finally { await db.close(); }
});
