import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';

test('name search uses current grants and administrator access, literal matching and pagination', async () => {
 const db = await storageDatabase();
 try {
  await db.exec(readFileSync('supabase/migrations/202611090001_search_tournaments.sql', 'utf8'));
  const own = randomUUID(), delegated = randomUUID(), hidden = randomUUID(), grant = randomUUID();
  for (const [id, actor, name] of [[own, owner, 'Summer'], [delegated, player, 'Summer Cup'], [hidden, stranger, 'Summer Hidden']]) await command(db, {event:id,actor,effects:{event:{name}}});
  await db.transaction(async tx => {
   await tx.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)', [delegated]);
   await tx.query('INSERT INTO tournament_admins(tournament_id,user_id,succession_order,granted_by) VALUES($1,$2,2,$3)', [delegated, owner, player]);
   await tx.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current()');
  });
  await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)', [grant,owner,'synthetic-test','connector',['admin:manage']]);
  const search = (query: string, offset=0, actor=owner, client='connector') => role(db,'service_role',actor,async()=> (await db.query<{result:{tournaments:{id:string;name:string}[];next_offset:number|null}}>('SELECT tb_search_tournaments($1,$2,$3,$4,$5) AS result',[actor,client,grant,query,offset])).rows[0].result);
  assert.deepEqual((await search(' sUmMeR ')).tournaments.map(t=>t.id),[own,delegated]);
  assert.equal((await search('%')).tournaments.length,0);
  await assert.rejects(search('   '), /INVALID_REQUEST/);
  await assert.rejects(search('Summer',-1), /INVALID_REQUEST/);
  await assert.rejects(search('Summer',0,player), /FORBIDDEN/);
  await assert.rejects(search('Summer',0,owner,'other'), /FORBIDDEN/);
  await assert.rejects(role(db,'authenticated',owner,()=>db.query('SELECT tb_search_tournaments($1,$2,$3,$4,0)',[owner,'connector',grant,'Summer'])), /permission denied/);
  for(let i=0;i<21;i++) await command(db,{event:randomUUID(),effects:{event:{name:'Summer '+String(i).padStart(2,'0')}}});
  const first=await search('Summer'),next=await search('Summer',first.next_offset!);
  assert.equal(first.tournaments.length,20); assert.equal(next.tournaments.length,3); assert.equal(next.next_offset,null);
  assert.equal(new Set([...first.tournaments,...next.tournaments].map(t=>t.id)).size,23);
  await db.query("UPDATE connection_grants SET permissions=ARRAY['owner:manage'] WHERE id=$1",[grant]);
  assert.ok(!(await search('Summer')).tournaments.some(t=>t.id===delegated));
  await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant]);
  await assert.rejects(search('Summer'), /GRANT_REVOKED/);
 } finally { await db.close(); }
});
