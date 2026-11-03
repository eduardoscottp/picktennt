import assert from 'node:assert/strict';
import test from 'node:test';
import { storageDatabase, command } from './helpers/storage-db';
test('SQL rejects guest enrollment without creating an event or identity', async () => {
  const db = await storageDatabase();
  try {
    await assert.rejects(command(db, { event: crypto.randomUUID(), command: 'addGuestEntry', revision: 0, request: { player_names: ['Guest'] } }), /ACCOUNT_REQUIRED/);
    assert.equal(Number((await db.query<{ n: number }>('SELECT count(*) n FROM tournaments')).rows[0].n), 0);
  } finally { await db.close(); }
});
