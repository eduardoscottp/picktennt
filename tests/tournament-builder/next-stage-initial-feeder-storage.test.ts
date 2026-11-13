import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { definitionHash } from '../../lib/tournament-builder/requests';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import { previewWithdrawal } from '../../lib/tournament-builder/corrections';

for (const withdrawals of [1, 2]) test(`an initial graph feeder with ${withdrawals} withdrawals agrees between review and SQL`, async () => {
  const db = await storageDatabase();
  try {
    const event = randomUUID(), actor: CommandActor = { id: owner, clientId: 'web', role: 'owner' };
    const context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
    const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
    d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
    d.registration.min_entries = 4; d.registration.max_entries = 4; d.event.courts = 2; d.scheduling.minimum_rest_minutes = 0;
    d.nodes = [{ id: 'reg', module: 'registration@1' }, { id: 'roster', module: 'entries@1', from: 'reg' },
      { id: 's1', module: 'match@1', inputs: [1, 4].map(seed => ({ kind: 'seed', seed })) },
      { id: 's2', module: 'match@1', inputs: [2, 3].map(seed => ({ kind: 'seed', seed })) },
      { id: 'final', module: 'match@1', inputs: ['s1', 's2'].map(node_id => ({ kind: 'winner', node_id })) },
      { id: 'places', module: 'placements@2', final: 'final' }];
    let current: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
    async function read() { return role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT tb_get_snapshot($1,$2,$3,NULL) value', [owner, 'web', event])).rows[0].value); }
    async function run(name: string, data: Record<string, unknown>, user: CommandActor = actor) {
      const plan = planCommand(current, user, name, data, context);
      await command(db, { event, actor: user.id, command: name, revision: current.event ? Number(current.event.revision) : null, request: data, effects: plan.effects, result: plan.result });
      current = await read();
    }
    await run('createDraft', { definition: d }); await run('publishTournament', { reviewed_definition_hash: definitionHash(d), acknowledged_warning_codes: [] });
    for (let i = 0; i < 4; i++) { const user = randomUUID(); await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [user, `${user}@example.invalid`]); await run('requestEntry', { definition_id: current.event!.definition_id, consent: true, entry_name: String.fromCharCode(65 + i) }, { id: user, clientId: 'web', role: 'player' }); }
    await run('closeRegistration', {}); await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision }); await run('startTournament', {});
    const other = current.matches.find(match => match.logical_key === 's2:match')!;
    await run('attestScore', { match_id: other.id, outcome_kind: 'played', score_a: 11, score_b: 5, reason: 'Observed' });
    const initial = current.matches.find(match => match.logical_key === 's1:match')!;
    const proposal = { entry_id: initial.team_b_id, reason: 'Team withdrew' };
    const withdrawal = previewWithdrawal(current, actor, proposal, context.now);
    await run('withdrawEntry', { ...proposal, preview_hash: withdrawal.preview_hash });
    assert.equal(current.matches.find(match => match.id === initial.id)?.outcome_kind, 'walkover');
    if (withdrawals === 2) {
      const second = { entry_id: initial.team_a_id, reason: 'Team withdrew' };
      const secondReview = previewWithdrawal(current, actor, second, context.now);
      await run('withdrawEntry', { ...second, preview_hash: secondReview.preview_hash });
      assert.equal(current.matches.find(match => match.id === initial.id)?.outcome_kind, 'walkover');
    }
    const review = previewNextStage(current, actor);
    assert.equal(review.state, 'ready', JSON.stringify(review));
    if (review.state !== 'ready') throw new Error('Expected ready review');
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    await command(db, { event, actor: owner, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
    if (withdrawals === 2) {
      const completed = await read();
      const placements = completed.stages.find(stage => stage.module_id === 'placements')!.output as { groups: { rank: number; entryIds: string[] }[] };
      assert.equal(completed.event!.modular_state, 'completed');
      assert.deepEqual(placements.groups.map(group => group.rank), [1, 3]);
      assert.deepEqual(placements.groups[0].entryIds, [other.team_a_id]);
      assert.deepEqual(placements.groups[1].entryIds, [other.team_b_id]);
      await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
      await db.exec(readFileSync('supabase/migrations/202611130004_graph_seed_pool_review.sql', 'utf8'));
      await db.exec(readFileSync('supabase/migrations/202611130005_graph_general_review.sql', 'utf8'));
      await db.exec(readFileSync('supabase/migrations/202611130006_graph_partial_auto_group.sql', 'utf8'));
      await db.exec(readFileSync('../rollback-next-stage-local.sql', 'utf8'));
      assert.deepEqual(await read(), completed, 'rollback must preserve scores, participants, placements and event state');
    }
  } finally { await db.close(); }
});
