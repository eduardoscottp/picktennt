import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { planCommand } from '../../lib/tournament-builder/commands';

let db: PGlite;
before(async () => { db = await storageDatabase(); });
after(async () => { await db.close(); });
const rpc: RpcClient = { async rpc(name, args) {
  try {
    const keys = Object.keys(args);
    const response = await role(db, 'service_role', owner, () => db.query<{ value: unknown }>(`SELECT public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) value`, Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value)));
    return { data: response.rows[0].value, error: null };
  } catch (error) { return { data: null, error: { message: String(error) } }; }
} };
const host = { id: owner, clientId: 'web' };

for (const doubles of [false, true]) test(`approval holds and releases a ${doubles ? 'doubles' : 'singles'} position with SQL enforcement`, async () => {
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  definition.event.starts_at = '2030-11-07T09:00:00-05:00'; definition.event.expected_end_at = '2030-11-07T12:30:00-05:00';
  definition.registration = { ...definition.registration, mode: 'approval', entry_type: doubles ? 'fixed_doubles' : 'singles', partner_consent: false, min_entries: 2, max_entries: 2, closes_at: '2030-11-06T18:00:00-05:00' };
  definition.nodes = definition.nodes.slice(0, 4).concat({ id: 'result', module: 'placements@1', from: 'rank' });
  const created = await executeCommand(rpc, host, 'createDraft', null, { operation_id: randomUUID(), data: { definition } });
  const id = created.tournament_id, preview = await previewTournament(rpc, host, id);
  await executeCommand(rpc, host, 'publishTournament', id, { operation_id: randomUUID(), expected_revision: created.revision, data: { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes ?? [] } });
  let s = await getSnapshot(rpc, host, id);
  const join = async (user: string) => executeCommand(rpc, { id: user, clientId: 'web' }, 'joinTournament', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: { definition_id: s.event!.definition_id, consent: true, slot_index: 1, position: 1 } });
  const stale = structuredClone(s);
  const staleRequest = { definition_id: s.event!.definition_id, consent: true, slot_index: 1, position: 1 };
  const stalePlan = planCommand(stale, { id: stranger, clientId: 'web' }, 'joinTournament', staleRequest, { now: new Date().toISOString(), id: randomUUID });
  await join(player); s = await getSnapshot(rpc, host, id);
  assert.equal(s.tournament_players.find(row => row.user_id === player)?.status, 'pending');
  assert.equal(s.team_members.find(row => row.user_id === player)?.membership_status, 'pending');
  const heldMember = s.team_members.find(row => row.user_id === player)!;
  await assert.rejects(() => command(db, { actor: player, event: id, revision: Number(s.event!.revision), command: 'selectEntrySlot', request: { slot_index: 1, position: 1 }, effects: { event: { roster_revision: Number(s.event!.roster_revision) + 1 }, team_members: [{ id: heldMember.id, membership_status: 'active' }] } }), /NOT_REGISTERED/);
  await assert.rejects(() => command(db, { actor: player, event: id, revision: Number(s.event!.revision), command: 'cancelEntry', request: { entry_id: heldMember.team_id }, effects: {} }), /INVALID_STATE/);
  const publicView = await getSnapshot(rpc, { id: stranger, clientId: 'web' }, id);
  const hold = publicView.team_members.find(row => row.player_slot === 1);
  assert.equal(hold?.display_name, 'Pending approval'); assert.equal(hold?.user_id, undefined);
  await assert.rejects(() => join(stranger), { code: 'SLOT_FULL' });
  await assert.rejects(() => command(db, { actor: stranger, event: id, revision: Number(s.event!.revision), command: 'joinTournament', request: staleRequest, effects: stalePlan.effects }), /INVALID_EFFECTS|SLOT_FULL/);
  await assert.rejects(() => executeCommand(rpc, host, 'closeRegistration', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: {} }), { code: 'PENDING_APPROVALS' });
  await assert.rejects(() => command(db, { actor: owner, event: id, revision: Number(s.event!.revision), command: 'closeRegistration', request: {}, effects: { event: { modular_state: 'registration_closed' } } }), /PENDING_APPROVALS/);
  await assert.rejects(() => executeCommand(rpc, { id: stranger, clientId: 'web' }, 'approveIndividual', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: { user_id: player } }), { code: 'FORBIDDEN' });
  await assert.rejects(() => command(db, { actor: stranger, event: id, revision: Number(s.event!.revision), command: 'approveIndividual', request: { user_id: player }, effects: {} }), /FORBIDDEN/);
  await executeCommand(rpc, host, 'rejectIndividual', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: { user_id: player, reason: 'Not eligible' } });
  s = await getSnapshot(rpc, host, id);
  assert.equal(s.team_members.find(row => row.user_id === player)?.membership_status, 'cancelled');
  await join(stranger); s = await getSnapshot(rpc, host, id);
  await executeCommand(rpc, host, 'approveIndividual', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: { user_id: stranger } });
  s = await getSnapshot(rpc, host, id);
  assert.equal(s.tournament_players.find(row => row.user_id === stranger)?.status, 'approved');
  assert.equal(s.team_members.find(row => row.user_id === stranger)?.membership_status, 'active');
  assert.equal(s.team_members.find(row => row.user_id === stranger)?.player_slot, 1);
  await executeCommand(rpc, host, 'adminFillPosition', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: { user_id: owner, slot_index: 2, position: 1, reason: 'Organizer enrollment' } });
  s = await getSnapshot(rpc, host, id);
  const adminEnrolled = s.team_members.find(row => row.user_id === owner && row.membership_status === 'active');
  assert.equal(s.tournament_players.find(row => row.user_id === owner)?.status, 'approved');
  assert.equal(adminEnrolled?.admission_source, 'administrator'); assert.equal(adminEnrolled?.consented_at, null);
  if (doubles) {
    await executeCommand(rpc, { id: player, clientId: 'web' }, 'joinTournament', id, { operation_id: randomUUID(), expected_revision: Number(s.event!.revision), data: { definition_id: s.event!.definition_id, consent: true, slot_index: 1, position: 2 } });
    const teammateView = await getSnapshot(rpc, { id: stranger, clientId: 'web' }, id);
    const held = teammateView.team_members.find(row => row.player_slot === 2);
    assert.equal(held?.display_name, 'Pending approval'); assert.equal(held?.user_id, undefined);
    assert.equal(teammateView.team_members.some(row => row.user_id === player), false);
  }
});

test('competing requests for the same position cannot both commit', async () => {
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  definition.event.starts_at = '2030-11-07T09:00:00-05:00'; definition.event.expected_end_at = '2030-11-07T12:30:00-05:00';
  definition.registration = { ...definition.registration, mode: 'approval', entry_type: 'singles', partner_consent: false, min_entries: 2, max_entries: 2, closes_at: '2030-11-06T18:00:00-05:00' };
  definition.nodes = definition.nodes.slice(0, 4).concat({ id: 'result', module: 'placements@1', from: 'rank' });
  const created = await executeCommand(rpc, host, 'createDraft', null, { operation_id: randomUUID(), data: { definition } });
  const id = created.tournament_id, preview = await previewTournament(rpc, host, id);
  await executeCommand(rpc, host, 'publishTournament', id, { operation_id: randomUUID(), expected_revision: created.revision, data: { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes ?? [] } });
  const snapshot = await getSnapshot(rpc, host, id);
  const request = { definition_id: snapshot.event!.definition_id, consent: true, slot_index: 1, position: 1 };
  const candidates = [player, stranger].map(user => ({ user, operation: randomUUID(), plan: planCommand(snapshot, { id: user, clientId: 'web' }, 'joinTournament', request, { now: new Date().toISOString(), id: randomUUID }) }));
  const outcomes = await role(db, 'service_role', owner, () => Promise.allSettled(candidates.map(candidate => db.query('SELECT public.tb_apply_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [candidate.user, 'web', candidate.operation, 'a'.repeat(64), 'joinTournament', id, Number(snapshot.event!.revision), JSON.stringify(request), JSON.stringify(candidate.plan.effects), JSON.stringify(candidate.plan.result), null]))));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const loser = outcomes.find(result => result.status === 'rejected');
  assert.ok(loser && loser.status === 'rejected'); assert.match(String(loser.reason), /STALE_REVISION|SLOT_FULL/);
  const after = await getSnapshot(rpc, host, id);
  assert.equal(after.team_members.filter(member => member.membership_status === 'pending').length, 1);
  assert.equal(after.tournament_players.filter(member => member.status === 'pending').length, 1);
});
