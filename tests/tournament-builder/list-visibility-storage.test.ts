import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { storageDatabase, role, owner, player, stranger } from './helpers/storage-db';

test('native listing exposes public, owned, administered, pending and approved tournaments only to eligible accounts', async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202610290003_tournament_list_visibility.sql', 'utf8'));
    const publicEvent = randomUUID(), privateEvent = randomUUID();
    await db.query("INSERT INTO tournaments(id,name,created_by,is_public,court_count,max_players,type) VALUES ($1,'Public',$3,true,1,4,'singles'),($2,'Private',$3,false,1,4,'singles')", [publicEvent, privateEvent, owner]);
    const visible = (actor: string) => role(db, 'authenticated', actor, async () => (await db.query<{id:string}>('SELECT id FROM tournaments ORDER BY id')).rows.map(row => row.id).sort());
    assert.deepEqual(await visible(owner), [publicEvent, privateEvent].sort());
    assert.deepEqual(await visible(player), [publicEvent]);
    await db.query("INSERT INTO tournament_players(tournament_id,user_id,status) VALUES ($1,$2,'pending')", [privateEvent, player]);
    assert.deepEqual(await visible(player), [publicEvent, privateEvent].sort());
    assert.deepEqual(await visible(stranger), [publicEvent]);
    await db.query("UPDATE tournament_players SET status='approved' WHERE tournament_id=$1", [privateEvent]);
    assert.deepEqual(await visible(player), [publicEvent, privateEvent].sort());
    await db.query("UPDATE tournament_players SET status='rejected' WHERE tournament_id=$1", [privateEvent]);
    assert.deepEqual(await visible(player), [publicEvent]);
    await db.query('INSERT INTO tournament_admins(tournament_id,user_id,succession_order) VALUES ($1,$2,2)', [privateEvent, stranger]);
    assert.deepEqual(await visible(stranger), [publicEvent, privateEvent].sort());
    await db.query('DELETE FROM tournament_admins WHERE tournament_id=$1 AND user_id=$2', [privateEvent,stranger]);
    assert.deepEqual(await visible(stranger), [publicEvent]);
    const team = randomUUID();
    await db.query("INSERT INTO teams(id,tournament_id,name) VALUES ($1,$2,'Invitation')", [team,privateEvent]);
    await db.query("INSERT INTO team_members(team_id,tournament_id,user_id,membership_status) VALUES ($1,$2,$3,'pending')", [team,privateEvent,player]);
    assert.deepEqual(await visible(player), [publicEvent, privateEvent].sort());
    await db.query("UPDATE team_members SET membership_status='cancelled' WHERE team_id=$1", [team]);
    assert.deepEqual(await visible(player), [publicEvent]);
    assert.deepEqual(await role(db, 'anon', '', async () => (await db.query<{id:string}>('SELECT id FROM tournaments')).rows.map(row=>row.id)), [publicEvent]);
  } finally { await db.close(); }
});
