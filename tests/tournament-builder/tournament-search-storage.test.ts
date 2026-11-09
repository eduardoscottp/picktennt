import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTournamentMcpServer, type McpDependencies } from '../../lib/tournament-builder/mcp';
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
  await db.query("INSERT INTO tournaments(name,created_by,court_count,max_players,type,status) VALUES('Summer legacy',$1,1,4,'doubles','registration')",[owner]);
  assert.deepEqual((await search('Summer')).tournaments.map(t=>t.id),[own,delegated]);
  const dependencies: McpDependencies = {
   permissions: ['admin:manage'], searchTournaments: search,
   execute: async () => { throw Error('Search must never mutate a tournament.'); },
   getDraft: async () => ({}), preview: async () => ({}), operation: async () => ({}),
   reviewLink: async tournamentId => ({ tournament_id:tournamentId, revision:1, review_url:'https://picktennt.example/tournaments/'+tournamentId+'/builder', publication_requires_owner_review:true }),
   admin: { snapshot: async tournamentId => role(db,'service_role',owner,async()=> (await db.query<{snapshot:unknown}>('SELECT tb_get_snapshot($1,$2,$3,$4) AS snapshot',[owner,'connector',tournamentId,grant])).rows[0].snapshot),findPlayer:async()=>({}),previewCorrection:async()=>({}),previewWithdrawal:async()=>({}) },
  };
  const server=createTournamentMcpServer(dependencies),client=new Client({name:'name-search-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a),client.connect(b)]);
  try {
   const tools=await client.listTools();
   const tool=tools.tools.find(tool=>tool.name==='search_tournaments');
   assert.equal(tool?.annotations?.readOnlyHint,true);
   const result=await client.callTool({name:'search_tournaments',arguments:{query:'sUmMeR'}});
   assert.notEqual(result.isError,true);
   const content=result.content as {type:string;text?:string}[];
   const found=JSON.parse(content.find(item=>item.type==='text')!.text!);
   assert.deepEqual(found.tournaments.map((item:{id:string})=>item.id),[own,delegated]);
   assert.equal(found.next_offset,null);
   assert.deepEqual(Object.keys(found.tournaments[0]).sort(),['id','name','revision','status']);
   const selected=await client.callTool({name:'admin_get_tournament',arguments:{tournament_id:found.tournaments[0].id}});
   assert.notEqual(selected.isError,true);
   assert.ok(JSON.stringify(selected).includes(own));
   const invalid=await client.callTool({name:'search_tournaments',arguments:{query:'   '}});
   assert.equal(invalid.isError,true);
   assert.doesNotMatch(JSON.stringify(invalid),/tb_search|connection_grants|SELECT/);
  } finally { await client.close(); await server.close(); }
  await assert.rejects(role(db,'anon',owner,()=>db.query('SELECT tb_search_tournaments($1,$2,$3,$4,0)',[owner,'connector',grant,'Summer'])), /permission denied/);
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
  await db.query("UPDATE connection_grants SET permissions=ARRAY['admin:manage'] WHERE id=$1",[grant]);
  assert.equal((await search('Summer Cup')).tournaments.length,1);
  await db.transaction(async tx => {
   await tx.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)', [delegated]);
   await tx.query('DELETE FROM tournament_admins WHERE tournament_id=$1 AND user_id=$2', [delegated,owner]);
   await tx.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current()');
  });
  assert.equal((await search('Summer Cup')).tournaments.length,0);
  await db.query("UPDATE connection_grants SET permissions=ARRAY['player:manage'] WHERE id=$1",[grant]);
  await assert.rejects(search('Summer'), /FORBIDDEN/);
  await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant]);
  await assert.rejects(search('Summer'), /GRANT_REVOKED/);
 } finally { await db.close(); }
});
