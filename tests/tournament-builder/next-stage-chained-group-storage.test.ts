import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, role, command, owner, stranger } from './helpers/storage-db';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { definitionHash } from '../../lib/tournament-builder/requests';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import { validateDraft } from '../../lib/tournament-builder/validate';

for (const shape of ['chain', 'parallel'] as const) test(`reviewed ${shape} graph validates stages, standings and waves in SQL`, async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130004_graph_seed_pool_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130005_graph_general_review.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611130006_graph_partial_auto_group.sql', 'utf8'));
    const event = randomUUID(), actor: CommandActor = { id: owner, clientId: 'web', role: 'owner' };
    const context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
    const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
    d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
    d.registration.min_entries = 4; d.registration.max_entries = 4; d.event.courts = 2; d.scheduling.minimum_rest_minutes = 0;
    const ranks = (node_id: string, values: number[]) => values.map(rank => ({ kind: 'rank', node_id, rank }));
    d.nodes = [{ id: 'reg', module: 'registration@1' }, { id: 'roster', module: 'entries@1', from: 'reg' },
      { id: 'initial', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })) },
      ...(shape === 'chain' ? [
        { id: 'pool', module: 'round_robin@2', inputs: ranks('initial', [1, 2, 3, 4]) },
        { id: 'cross', module: 'cross_play@1', side_a: ranks('pool', [1, 2]), side_b: ranks('pool', [3, 4]) },
        { id: 'final', module: 'match@1', inputs: ranks('cross', [1, 2]) },
      ] : [
        { id: 'pool', module: 'round_robin@2', inputs: ranks('initial', [1, 2]) },
        { id: 'cross', module: 'round_robin@2', inputs: ranks('initial', [3, 4]) },
        { id: 'final', module: 'match@1', inputs: [...ranks('pool', [1]), ...ranks('cross', [1])] },
      ]),
      { id: 'places', module: 'placements@2', final: 'final' }];
    let current: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
    async function read() { return role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT tb_get_snapshot($1,$2,$3,NULL) value', [owner, 'web', event])).rows[0].value); }
    async function run(name: string, data: Record<string, unknown>, user: CommandActor = actor) {
      const plan = planCommand(current, user, name, data, context);
      await command(db, { event, actor: user.id, command: name, revision: current.event ? Number(current.event.revision) : null, request: data, effects: plan.effects, result: plan.result });
      current = await read();
    }
    await run('createDraft', { definition: d }); await run('publishTournament', { reviewed_definition_hash: definitionHash(d), acknowledged_warning_codes: [...new Set(validateDraft(d, { publication: true, registration: true, now: new Date(context.now) }).warnings.map(warning => warning.code))] });
    for (let i = 0; i < 4; i++) { const user = randomUUID(); await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [user, `${user}@example.invalid`]); await run('requestEntry', { definition_id: current.event!.definition_id, consent: true, entry_name: String.fromCharCode(65 + i) }, { id: user, clientId: 'web', role: 'player' }); }
    await run('closeRegistration', {});
    await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision, group_assignments: { initial: current.teams.map(team => team.id) } });
    await run('startTournament', {});
    assert.equal(current.matches.length, 6);
    for (const match of [...current.matches]) {
      const a = current.teams.find(team => team.id === match.team_a_id)!, b = current.teams.find(team => team.id === match.team_b_id)!;
      const win = String(a.name) < String(b.name);
      await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: win ? 11 : 5, score_b: win ? 5 : 11, reason: 'Observed' });
    }
    const review = previewNextStage(current, actor); assert.equal(review.state, 'ready', JSON.stringify(review));
    if (review.state !== 'ready') throw new Error('Expected ready review');
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    const input = { event, actor: owner, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result };
    await assert.rejects(command(db, { ...input, actor: stranger }), /FORBIDDEN/);
    await assert.rejects(command(db, { ...input, revision: input.revision - 1 }), /STALE_REVISION/);
    for (const corruption of ['stage', 'standing', 'wave', 'link', 'court'] as const) {
      const bad = structuredClone(plan.effects);
      if (corruption === 'stage') bad.stages!.find(stage => current.stages.find(saved => saved.id === stage.id)?.node_id === 'cross')!.state = 'completed';
      if (corruption === 'standing') bad.standings!.find(standing => current.stages.find(saved => saved.id === standing.stage_id)?.node_id === 'pool')!.wins = 99;
      if (corruption === 'wave') {
        const first = bad.rounds!.find(round => current.stages.find(saved => saved.id === round.stage_id)?.node_id === 'pool')!;
        const later = bad.rounds!.find(round => current.stages.find(saved => saved.id === round.stage_id)?.node_id === (shape === 'chain' ? 'cross' : 'final'))!;
        later.logical_wave = first.logical_wave;
      }
      if (corruption === 'link') bad.matches!.find(match => current.stages.find(saved => saved.id === match.stage_id)?.node_id === 'final')!.bracket_next_winner_match_id = randomUUID();
      if (corruption === 'court') bad.matches!.find(match => current.stages.find(saved => saved.id === match.stage_id)?.node_id === 'pool')!.court_number = 999;
      await assert.rejects(command(db, { ...input, effects: bad }), /INVALID_EFFECTS|INVALID_STATE/);
    }
    assert.equal((await read()).matches.length, 6);
    const operation = randomUUID(), receipt = await command(db, { ...input, operation });
    assert.deepEqual(await command(db, { ...input, operation }), receipt);
    await assert.rejects(command(db, input), /STALE_REVISION/);
    const result = await read();
    assert.ok(result.matches.some(match => current.stages.find(stage => stage.id === match.stage_id)?.node_id === 'pool'));
    assert.ok(result.matches.some(match => current.stages.find(stage => stage.id === match.stage_id)?.node_id === 'cross'));
    assert.ok(result.matches.some(match => current.stages.find(stage => stage.id === match.stage_id)?.node_id === 'final'));
  } finally { await db.close(); }
});
