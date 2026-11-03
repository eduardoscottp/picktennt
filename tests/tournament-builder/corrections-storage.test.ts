import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { definitionHash, requestHash } from '../../lib/tournament-builder/requests';
import { command as applySql, owner, player, stranger, role, storageDatabase } from './helpers/storage-db';

test('real SQL preserves replay history, successor identities and before/after-playoff withdrawal boundaries', async () => {
  const db = await storageDatabase(), host: CommandActor = { id: owner, clientId: 'web', role: 'owner' };
  const players = [owner, player, stranger, randomUUID(), randomUUID(), randomUUID()];
  for (const id of players.slice(3)) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@example.invalid`]);
  try {
    async function setup(n: number, combined: boolean) {
      const eventId = randomUUID();
      let snapshot: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
      async function refresh() {
        const result = await role(db, 'service_role', owner, () => db.query<{ value: CommandSnapshot }>("SELECT public.tb_get_snapshot($1,'web',$2,NULL) AS value", [owner, eventId]));
        snapshot = result.rows[0].value;
      }
      async function run(name: string, data: Record<string, unknown> = {}, actor = host) {
        const revision = snapshot.event ? Number(snapshot.event.revision) : null;
        const plan = planCommand(snapshot, actor, name, data, { now: new Date().toISOString(), id: randomUUID, draw: ids => [...ids] });
        await applySql(db, { actor: actor.id, event: eventId, command: name, revision, hash: requestHash(name, eventId, revision ?? undefined, data), request: data, effects: plan.effects, result: plan.result });
        await refresh();
      }
      const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
      definition.event.starts_at = '2030-11-07T09:00:00-05:00'; definition.event.expected_end_at = '2030-11-07T16:00:00-05:00';
      definition.registration = { ...definition.registration, min_entries: 2, max_entries: n, entry_type: 'singles', partner_consent: false, mode: 'open', closes_at: '2030-11-06T18:00:00-05:00' };
      definition.scheduling.minimum_rest_minutes = 0;
      if (!combined) definition.nodes = [definition.nodes[0], definition.nodes[1], { id: 'playoff', module: 'elimination@1', from: 'roster', config: { seeding: 'draw', bronze: false } }, { id: 'result', module: 'placements@1', from: 'playoff' }];
      await run('createDraft', { definition });
      await run('publishTournament', { reviewed_definition_hash: definitionHash(definition), acknowledged_warning_codes: [] });
      for (let i = 0; i < n; i++) await run('requestEntry', { consent: true, definition_id: snapshot.event!.definition_id, entry_name: String.fromCharCode(65 + i) }, { id: players[i], clientId: 'web' });
      await run('closeRegistration'); await run('lockRoster', { reviewed_roster_revision: snapshot.event!.roster_revision }); await run('startTournament');
      async function finish(matchId: string) {
        const match = snapshot.matches.find(m => m.id === matchId)!;
        const a = snapshot.teams.find(t => t.id === match.team_a_id)!, b = snapshot.teams.find(t => t.id === match.team_b_id)!;
        await run('startMatch', { match_id: matchId });
        await run('attestScore', { match_id: matchId, score_a: String(a.name) < String(b.name) ? 11 : 5, score_b: String(a.name) < String(b.name) ? 5 : 11, reason: 'Both entries confirmed the final score.' });
      }
      return { get snapshot() { return snapshot; }, eventId, run, finish };
    }
    const direct = await setup(4, false);
    const semis = direct.snapshot.matches.filter(m => String(m.logical_key).includes(':r1:'));
    for (const match of semis) await direct.finish(match.id);
    const source = direct.snapshot.matches.find(m => m.id === semis[0].id)!, untouched = structuredClone(direct.snapshot.matches.find(m => m.id === semis[1].id)!);
    const oldFinal = direct.snapshot.matches.find(m => String(m.logical_key).includes(':r2:'))!;
    await direct.run('startMatch', { match_id: oldFinal.id });
    const proposed = { match_id: source.id, score_a: source.score_b, score_b: source.score_a }, preview = previewCorrection(direct.snapshot, host, proposed);
    assert.deepEqual(preview.started_dependent_ids, [oldFinal.id]);
    await direct.run('commitCorrection', { ...proposed, preview_hash: preview.preview_hash, reason: 'Reviewed source correction and replay.', resolution: 'void_and_replay' });
    const history = direct.snapshot.matches.find(m => m.id === oldFinal.id)!, replay = direct.snapshot.matches.find(m => m.logical_key === oldFinal.logical_key && m.is_current)!;
    assert.equal(history.is_current, false); assert.ok(history.voided_at); assert.ok(history.ended_at); assert.notEqual(replay.id, oldFinal.id);
    assert.equal(direct.snapshot.matches.find(m => m.id === source.id)!.bracket_next_winner_match_id, replay.id);
    const preserved = direct.snapshot.matches.find(m => m.id === untouched.id)!;
    for (const field of ['id', 'team_a_id', 'team_b_id', 'status', 'score_a', 'score_b', 'winner_team_id', 'outcome_kind', 'is_current', 'revision', 'result_revision', 'started_at', 'ended_at']) assert.equal(preserved[field], untouched[field]);
    assert.equal(preserved.bracket_next_winner_match_id, replay.id, 'Unaffected result feeds the replacement final.');
    const audit = await db.query<{ reason: string; before_facts: CommandSnapshot; after_facts: CommandSnapshot }>('SELECT reason,before_facts,after_facts FROM tournament_operations WHERE tournament_id=$1 AND command=$2', [direct.eventId, 'commitCorrection']);
    assert.equal(audit.rows.length, 1); assert.ok(audit.rows[0].before_facts.matches.some(m => m.id === oldFinal.id && m.is_current)); assert.ok(audit.rows[0].after_facts.matches.some(m => m.id === oldFinal.id && m.is_current === false));

    const combined = await setup(6, true);
    for (const match of [...combined.snapshot.matches]) await combined.finish(match.id);
    const teamD = combined.snapshot.teams.find(t => t.name === 'D')!, teamE = combined.snapshot.teams.find(t => t.name === 'E')!, teamF = combined.snapshot.teams.find(t => t.name === 'F')!;
    const first = { entry_id: teamD.id, reason: 'withdrew' }, before = previewWithdrawal(combined.snapshot, host, first);
    await combined.run('withdrawEntry', { ...first, preview_hash: before.preview_hash });
    assert.ok((combined.snapshot.stages.find(s => s.module_id === 'qualify')!.output as { entryIds: string[] }).entryIds.includes(teamE.id));
    const unrelated = combined.snapshot.matches.find(m => String(m.logical_key).startsWith('playoff:') && m.team_a_id && m.team_b_id && ![m.team_a_id, m.team_b_id].includes(teamE.id))!;
    await combined.run('startMatch', { match_id: unrelated.id });
    const second = { entry_id: teamE.id, reason: 'withdrew' }, after = previewWithdrawal(combined.snapshot, host, second);
    await combined.run('withdrawEntry', { ...second, preview_hash: after.preview_hash });
    assert.ok(!(combined.snapshot.stages.find(s => s.module_id === 'qualify')!.output as { entryIds: string[] }).entryIds.includes(teamF.id));
    assert.equal(combined.snapshot.matches.find(m => m.id === unrelated.id)!.status, 'in_progress');
    assert.ok(combined.snapshot.matches.some(m => m.outcome_kind === 'walkover'));
    assert.ok(combined.snapshot.matches.filter(m => String(m.logical_key).startsWith('rr:')).every(m => m.excluded_at == null));
  } finally { await db.close(); }
});
