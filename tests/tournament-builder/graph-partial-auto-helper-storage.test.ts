import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, role, command, owner, stranger } from './helpers/storage-db';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { planGraphRuntime } from '../../lib/tournament-builder/graph-command-runtime';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import { previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { definitionHash } from '../../lib/tournament-builder/requests';
import { validateDraft } from '../../lib/tournament-builder/validate';

test('isolated SQL validates a deferred group with automatic results and rejects forgeries', async () => {
  const db = await storageDatabase();
  try {
    for (const file of ['202611130003_graph_fixture_ports.sql', '202611130004_graph_seed_pool_review.sql', '202611130005_graph_general_review.sql', '202611130006_graph_partial_auto_group.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    const event = randomUUID(), actor: CommandActor = { id: owner, clientId: 'web', role: 'owner' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
    const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
    d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
    d.registration.min_entries = d.registration.max_entries = 4; d.event.courts = 2; d.scheduling.minimum_rest_minutes = 0;
    d.nodes = [{ id: 'reg', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'reg' },
      { id: 'initial', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })) },
      { id: 'pool', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(rank => ({ kind: 'rank', node_id: 'initial', rank })) },
      { id: 'final', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'pool', rank })) },
      { id: 'places', module: 'placements@2', final: 'final' }];
    let current: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
    async function read() { return role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT tb_get_snapshot($1,$2,$3,NULL) value', [owner, 'web', event])).rows[0].value); }
    async function run(name: string, data: Record<string, unknown>, user: CommandActor = actor) { const plan = planCommand(current, user, name, data, context); await command(db, { event, actor: user.id, command: name, revision: current.event ? Number(current.event.revision) : null, request: data, effects: plan.effects, result: plan.result }); current = await read(); }
    await run('createDraft', { definition: d });
    await run('publishTournament', { reviewed_definition_hash: definitionHash(d), acknowledged_warning_codes: [...new Set(validateDraft(d, { publication: true, registration: true, now: new Date(context.now) }).warnings.map(warning => warning.code))] });
    for (let i = 0; i < 4; i++) { const user = randomUUID(); await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [user, `${user}@example.invalid`]); await run('requestEntry', { definition_id: current.event!.definition_id, consent: true, entry_name: String.fromCharCode(65 + i) }, { id: user, clientId: 'web', role: 'player' }); }
    await run('closeRegistration', {}); await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision, group_assignments: { initial: current.teams.map(team => team.id) } }); await run('startTournament', {});
    for (const match of [...current.matches]) { const a = current.teams.find(team => team.id === match.team_a_id)!, b = current.teams.find(team => team.id === match.team_b_id)!, win = String(a.name) < String(b.name); await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: win ? 11 : 5, score_b: win ? 5 : 11, reason: 'Observed' }); }
    const proposal = { entry_id: current.teams.find(team => team.name === 'D')!.id, reason: 'Team withdrew' };
    const withdrawal = previewWithdrawal(current, actor, proposal, context.now); await run('withdrawEntry', { ...proposal, preview_hash: withdrawal.preview_hash });
    const roster = current.stages.find(stage => stage.module_id === 'entries')!, node = d.nodes.find(node => node.id === 'pool')!, stage = current.stages.find(stage => stage.node_id === 'pool')!;
    const rosterOutput = roster.output as { entryIds: string[]; seedAssignments?: Record<string, string> };
    const entries = rosterOutput.entryIds.map(id => ({ id, playerIds: [] }));
    const results = current.matches.map(match => ({ fixtureId: String(match.logical_key), accepted: true, outcome: 'played' as const, winnerEntryId: String(match.winner_team_id), scoreA: Number(match.score_a), scoreB: Number(match.score_b) }));
    const fixtureIds = analyzeGraph(d, entries, results, { allowIncompleteRoster: true, seedAssignments: rosterOutput.seedAssignments, eligibleEntryIds: current.teams.filter(team => team.entry_state === 'approved').map(team => team.id) }).fixtures.map(fixture => fixture.id);
    const copy = structuredClone(current), copyRoster = copy.stages.find(item => item.id === roster.id)!; copyRoster.output = { ...rosterOutput, graphNextStageApproved: true };
    const plan = planGraphRuntime(copy, d, actor, context, Number(current.event!.revision) + 1, new Set(), new Set(fixtureIds));
    const bindings = (await db.query<{ value: unknown }>('SELECT tournament_builder_private.graph_resolve_auto_group_bindings($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) value', [event, current.event!.definition_id, JSON.stringify(d.nodes), JSON.stringify(rosterOutput), JSON.stringify(node)])).rows[0].value;
    const validate = (effects: typeof plan.effects, actorId = owner) => db.query('SELECT tournament_builder_private.validate_graph_partial_auto_group($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb)', [event, actorId, JSON.stringify(node), JSON.stringify(rosterOutput), stage.id, JSON.stringify(effects.stages!.find(item => item.id === stage.id)), JSON.stringify(effects.standings), JSON.stringify(effects.matches), JSON.stringify(bindings), JSON.stringify(effects.rounds), current.event!.roster_revision, d.event.courts, Number(current.event!.revision) + 1, JSON.stringify(d.policies.ranking.order)]);
    const automatic = plan.effects.matches!.find(match => match.stage_id === stage.id && match.outcome_kind === 'walkover'); assert.ok(automatic);
    for (const corruption of ['winner', 'status', 'standing', 'actor'] as const) {
      const bad = structuredClone(plan.effects), match = bad.matches!.find(item => item.id === automatic.id)!;
      if (corruption === 'winner') match.winner_team_id = randomUUID();
      if (corruption === 'status') match.status = 'scheduled';
      if (corruption === 'standing') bad.standings!.find(row => row.stage_id === stage.id)!.wins = 99;
      await assert.rejects(validate(bad, corruption === 'actor' ? stranger : owner), /INVALID_EFFECTS/);
    }
    await validate(plan.effects);
    assert.deepEqual(await read(), current);
  } finally { await db.close(); }
});
