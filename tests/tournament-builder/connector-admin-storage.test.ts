import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, getOperation, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import type { CommandActor } from '../../lib/tournament-builder/commands';
let db: PGlite;
before(async()=>{db=await storageDatabase();});after(async()=>{await db?.close();});
const rpc: RpcClient={async rpc(name,args){
 assert.ok(['tb_get_snapshot','tb_get_operation','tb_apply_command'].includes(name));
 try{const keys=Object.keys(args);const result=await role(db,'service_role',owner,()=>db.query<{value:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,Object.values(args).map(value=>value&&typeof value==='object'?JSON.stringify(value):value)));return {data:result.rows[0].value,error:null};}
 catch(error){return {data:null,error:{message:String(error)}};}
}};
async function connector(userId=owner,permissions=['admin:manage']):Promise<CommandActor>{
 const grantId=randomUUID();await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,userId,'synthetic-test','connector',permissions]);
 return {id:userId,clientId:'connector',grantId,permissions:['admin:manage'],role:'owner'};
}
async function fixture(publish=true,userId=owner){
 const host={id:userId,clientId:'web'};
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
 definition.registration={...definition.registration,entry_type:'singles',partner_consent:false,mode:'approval',min_entries:2,max_entries:2,closes_at:'2030-11-06T18:00:00-05:00'};
 definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
 const created=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition}});
 const event=created.tournament_id;let revision=created.revision;
 const run=async(command:string,data:Record<string,unknown>={},actor:CommandActor=host)=>{const receipt=await executeCommand(rpc,actor,command,event,{operation_id:randomUUID(),expected_revision:revision,data});revision=receipt.revision;return receipt;};
 const preview=await previewTournament(rpc,host,event),publishData={reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]};
 if(publish)await run('publishTournament',publishData);
 const snapshot=await getSnapshot(rpc,host,event);
 return {event,host,run,publishData,definitionId:String(snapshot.event!.definition_id),revision:()=>revision};
}
function registration(f:Awaited<ReturnType<typeof fixture>>,profileId:string){return {definition_id:f.definitionId,player_ids:[profileId],entry_name:`Account ${profileId.slice(-4)}`,reason:'Explicit connector administrator enrollment.'};}
async function complete(f:Awaited<ReturnType<typeof fixture>>,actor:CommandActor){
 await f.run('addRegisteredEntry',registration(f,player),actor);await f.run('addRegisteredEntry',registration(f,stranger),actor);
 const roster=await getSnapshot(rpc,actor,f.event);await f.run('closeRegistration',{},actor);await f.run('lockRoster',{reviewed_roster_revision:roster.event!.roster_revision},actor);await f.run('startTournament',{},actor);
 const active=await getSnapshot(rpc,actor,f.event);await f.run('attestScore',{match_id:active.matches[0].id,score_a:11,score_b:5,outcome_kind:'played',reason:'Connector administrator validated played score.'},actor);
 return getSnapshot(rpc,actor,f.event);
}
test('current connector administrator completes an actual SQL event with existing profiles and direct result validation',async()=>{
 const actor=await connector(),f=await fixture();const before=(await db.query('SELECT count(*) n FROM auth.users')).rows[0];
 assert.equal((await getSnapshot(rpc,actor,f.event)).caller_role,'owner');
 const completed=await complete(f,actor);assert.equal(completed.event!.modular_state,'completed');assert.equal(completed.matches[0].outcome_kind,'played');assert.equal(completed.matches[0].status,'validated');
 assert.deepEqual(completed.team_members.map(member=>member.user_id).sort(),[player,stranger].sort());
 assert.ok(completed.team_members.every(member=>member.admission_source==='administrator'&&member.consented_at===null));
 assert.equal((completed.stages.find(stage=>stage.module_id==='placements')!.output as {groups:unknown[]}).groups.length,2);
 assert.deepEqual((await db.query('SELECT count(*) n FROM auth.users')).rows[0],before);
});
test('old draft grant cannot gain administration from claimed actor permissions and grant permission arrays stay constrained',async()=>{
 const actor=await connector(owner,['draft:create','draft:read','draft:update','operation:read']),f=await fixture();
 assert.equal((await getSnapshot(rpc,actor,f.event)).caller_role,'owner');
 await assert.rejects(f.run('addRegisteredEntry',registration(f,player),actor),{code:'FORBIDDEN'});
 await assert.rejects(f.run('closeRegistration',{},actor),{code:'FORBIDDEN'});
 assert.deepEqual((await db.query<{permissions:string[]}>('SELECT permissions FROM connection_grants WHERE id=$1',[actor.grantId])).rows[0].permissions,['draft:create','draft:read','draft:update','operation:read']);
 await assert.rejects(db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[randomUUID(),owner,'synthetic-test','connector',['admin:all']]),/check constraint/i);
});
test('connector grants remain bound to the actor, client and current administration of each event',async()=>{
 const actor=await connector(),f=await fixture(),foreign=await fixture(true,stranger),outsider=await connector(player);
 for(const invalid of [{...actor,id:player},{...actor,clientId:'another-connector'},outsider]){
  await assert.rejects(getSnapshot(rpc,invalid,f.event),{code:'FORBIDDEN'});
  await assert.rejects(f.run('addRegisteredEntry',registration(f,player),invalid),{code:'FORBIDDEN'});
 }
 await assert.rejects(getSnapshot(rpc,actor,foreign.event),{code:'FORBIDDEN'});
 await assert.rejects(foreign.run('closeRegistration',{},actor),{code:'FORBIDDEN'});
});
test('revocation blocks reads, mutations and recovery of an already committed connector receipt',async()=>{
 const actor=await connector(),f=await fixture();const operation={operation_id:randomUUID(),expected_revision:f.revision(),data:registration(f,player)};
 const receipt=await executeCommand(rpc,actor,'addRegisteredEntry',f.event,operation);
 assert.deepEqual(await getOperation(rpc,actor,operation.operation_id),receipt);
 await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[actor.grantId]);
 await assert.rejects(getSnapshot(rpc,actor,f.event),{code:'GRANT_REVOKED'});
 await assert.rejects(executeCommand(rpc,actor,'addRegisteredEntry',f.event,operation),{code:'GRANT_REVOKED'});
 await assert.rejects(getOperation(rpc,actor,operation.operation_id),{code:'GRANT_REVOKED'});
 assert.equal(Number((await db.query<{n:number}>('SELECT count(*) n FROM tournament_operations WHERE operation_id=$1',[operation.operation_id])).rows[0].n),1);
 assert.equal((await getSnapshot(rpc,f.host,f.event)).event!.revision,receipt.revision);
});
test('publish, cancel and completed-result reopening remain owner website actions even with admin scope',async()=>{
 const actor=await connector(),draft=await fixture(false);
 await assert.rejects(draft.run('publishTournament',draft.publishData,actor),{code:'FORBIDDEN'});
 await draft.run('publishTournament',draft.publishData);
 await assert.rejects(draft.run('cancelTournament',{reason:'Connector may not cancel.'},actor),{code:'FORBIDDEN'});
 const completed=await complete(draft,actor);assert.equal(completed.event!.modular_state,'completed');
 await assert.rejects(draft.run('reopenResults',{reason:'Connector may not reopen.'},actor),{code:'FORBIDDEN'});
 await draft.run('reopenResults',{reason:'Owner reviews on website.'});
 assert.equal((await getSnapshot(rpc,draft.host,draft.event)).event!.results_under_review,true);
});
test('delegated administrator removal invalidates connector authority and cached receipts immediately',async()=>{
 const actor=await connector(player),f=await fixture();
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)',[f.event]);
  await tx.query('INSERT INTO tournament_admins(tournament_id,user_id,succession_order,granted_by) VALUES($1,$2,2,$3)',[f.event,player,owner]);
  await tx.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current()');
 });
 assert.equal((await getSnapshot(rpc,actor,f.event)).caller_role,'admin');
 const operation={operation_id:randomUUID(),expected_revision:f.revision(),data:registration(f,stranger)};
 const receipt=await executeCommand(rpc,actor,'addRegisteredEntry',f.event,operation);assert.deepEqual(await getOperation(rpc,actor,operation.operation_id),receipt);
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)',[f.event]);
  await tx.query('DELETE FROM tournament_admins WHERE tournament_id=$1 AND user_id=$2',[f.event,player]);
  await tx.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current()');
 });
 await assert.rejects(getSnapshot(rpc,actor,f.event),{code:'FORBIDDEN'});
 await assert.rejects(executeCommand(rpc,actor,'addRegisteredEntry',f.event,operation),{code:'FORBIDDEN'});
 await assert.rejects(getOperation(rpc,actor,operation.operation_id),{code:'FORBIDDEN'});
});
