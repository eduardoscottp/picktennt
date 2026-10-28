import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { storageDatabase, owner, player, role } from './helpers/storage-db';

test('web service and actual SQL complete a singles event; retry is stable after completion', async () => {
  const db = await storageDatabase();
  const rpc: RpcClient = { async rpc(name, args) {
    assert.ok(['tb_get_snapshot', 'tb_get_operation', 'tb_apply_command'].includes(name));
    const keys = Object.keys(args);
    try {
      const result = await role(db, 'service_role', owner, () => db.query<{ value: unknown }>(
        `SELECT public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) AS value`,
        Object.values(args).map(value => typeof value === 'object' && value !== null ? JSON.stringify(value) : value),
      ));
      return { data: result.rows[0].value, error: null };
    } catch (error) { return { data: null, error: { message: String(error) } }; }
  } };
  const host = { id: owner, clientId: 'web' }, opponent = { id: player, clientId: 'web' };
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  definition.event.starts_at = '2030-11-07T09:00:00-05:00';
  definition.event.expected_end_at = '2030-11-07T12:30:00-05:00';
  definition.registration = { ...definition.registration, entry_type: 'singles', partner_consent: false, mode: 'open', min_entries: 2, max_entries: 2, closes_at: '2030-11-06T18:00:00-05:00' };
  definition.nodes = definition.nodes.slice(0, 4).concat({ id: 'result', module: 'placements@1', from: 'rank' });
  definition.scheduling.minimum_rest_minutes = 0;
  definition.event.visibility = 'public';
  const createInput = { operation_id: randomUUID(), data: { definition } };
  try {
    const created = await executeCommand(rpc, host, 'createDraft', null, createInput);
    const id = created.tournament_id;
    let revision = created.revision;
    const run = async (command: string, data: Record<string, unknown> = {}, actor = host) => {
      const receipt = await executeCommand(rpc, actor, command, id, { operation_id: randomUUID(), expected_revision: revision, data });
      revision = receipt.revision; return receipt;
    };
    assert.deepEqual(await executeCommand(rpc, host, 'createDraft', null, createInput), created);
    const preview = await previewTournament(rpc, host, id);
    await run('publishTournament', { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes ?? [] });
    const published = await getSnapshot(rpc, host, id);
    const consent = { definition_id: published.event?.definition_id, consent: true };
    await run('requestEntry', consent);
    await run('requestEntry', consent, opponent);
    await run('closeRegistration');
    await run('lockRoster', { reviewed_roster_revision: (await getSnapshot(rpc, host, id)).event?.roster_revision });
    await run('startTournament');
    let snapshot = await getSnapshot(rpc, host, id);
    const match = snapshot.matches[0];
    await run('startMatch', { match_id: match.id });
    const submitInput = { operation_id: randomUUID(), expected_revision: revision, data: { match_id: match.id, score_a: 11, score_b: 9 } };
    const submitted = await executeCommand(rpc, host, 'submitScore', id, submitInput);
    revision = submitted.revision;
    snapshot = await getSnapshot(rpc, host, id);
    await run('confirmScore', { match_id: match.id, result_revision: snapshot.matches[0].result_revision }, opponent);
    snapshot = await getSnapshot(rpc, host, id);
    assert.equal(snapshot.event?.modular_state, 'completed');
    assert.equal(snapshot.matches.length, 1);
    assert.deepEqual(await executeCommand(rpc, host, 'submitScore', id, submitInput), submitted);
    await assert.rejects(executeCommand(rpc, host, 'submitScore', id, { ...submitInput, data: { ...submitInput.data, score_b: 8 } }), /idempotency conflict/i);
  } finally { await db.close(); }
});

