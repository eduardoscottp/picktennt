import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, getOperation, type RpcClient } from '../../lib/tournament-builder/repository';
import { previewOwnerAction } from '../../lib/tournament-builder/owner-actions';
import type { CommandActor } from '../../lib/tournament-builder/commands';
let db:PGlite;
before(async()=>{db=await storageDatabase();});after(async()=>{await db?.close();});
const host={id:owner,clientId:'web'};
const rpc:RpcClient={async rpc(name,args){try{const keys=Object.keys(args);const result=await role(db,'service_role',owner,()=>db.query<{v:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) v`,Object.values(args).map(value=>value&&typeof value==='object'?JSON.stringify(value):value)));return {data:result.rows[0].v,error:null};}catch(error){return {data:null,error:{message:String(error)}};}}};
async function fixture(){const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));const receipt=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition}});return receipt.tournament_id;}
async function change(event:string,action:'addAdministrator'|'removeAdministrator',userId:string,actor:CommandActor=host){
 const snapshot=await getSnapshot(rpc,actor,event),data={user_id:userId,reason:'Owner reviewed administrator access.'};
 const proof=previewOwnerAction(snapshot,actor,action,data);
 const input={operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{...data,confirmed_owner_action:true,reviewed_action_hash:proof.preview_hash}};
 const receipt=await executeCommand(rpc,actor,action,event,input);return {receipt,input};
}
test('SQL owner adds and removes real administrators with stable replay, ordered succession and before/after history',async()=>{
 const event=await fixture();const initial=await getSnapshot(rpc,host,event);assert.equal(initial.admins!.length,1);assert.equal(initial.admins![0].user_id,owner);
 const first=await change(event,'addAdministrator',player);assert.deepEqual(await executeCommand(rpc,host,'addAdministrator',event,first.input),first.receipt);
 await change(event,'addAdministrator',stranger);let snapshot=await getSnapshot(rpc,host,event);
 assert.deepEqual(snapshot.admins!.map(row=>Number(row.succession_order)),[1,2,3]);assert.equal(snapshot.admins![1].granted_by,owner);assert.ok(snapshot.admins![1].display_name);
 const removed=await change(event,'removeAdministrator',player);snapshot=await getSnapshot(rpc,host,event);
 assert.deepEqual(snapshot.admins!.map(row=>row.user_id),[owner,stranger]);assert.deepEqual(snapshot.admins!.map(row=>Number(row.succession_order)),[1,2]);assert.equal(snapshot.event!.created_by,owner);
 assert.deepEqual(await executeCommand(rpc,host,'removeAdministrator',event,removed.input),removed.receipt);
 const audit=(await db.query<{reason:string;before_facts:{admins:unknown[]};after_facts:{admins:unknown[]}}>('SELECT reason,before_facts,after_facts FROM tournament_operations WHERE operation_id=$1',[removed.input.operation_id])).rows[0];
 assert.equal(audit.reason,removed.input.data.reason);assert.equal(audit.before_facts.admins.length,3);assert.equal(audit.after_facts.admins.length,2);
});
test('SQL role guards protect the owner and reject missing profiles, delegated changes and smuggled effects',async()=>{
 const event=await fixture();await change(event,'addAdministrator',player);
 await assert.rejects(change(event,'removeAdministrator',owner),{code:'FORBIDDEN'});
 await assert.rejects(change(event,'addAdministrator',randomUUID()),{code:'ACCOUNT_REQUIRED'});
 await assert.rejects(change(event,'addAdministrator',stranger,{id:player,clientId:'web',role:'owner'}),{code:'FORBIDDEN'});
 const snapshot=await getSnapshot(rpc,host,event),base={event,revision:Number(snapshot.event!.revision),request:{user_id:owner,reason:'Must protect owner',confirmed_owner_action:true,reviewed_action_hash:'a'.repeat(64)}};
 await assert.rejects(command(db,{...base,command:'removeAdministrator',effects:{admin_change:{action:'remove',id:snapshot.admins![0].id,user_id:owner}}}),/FORBIDDEN/);
 await assert.rejects(command(db,{...base,command:'updateDraft',effects:{admin_change:{action:'add',id:randomUUID(),user_id:stranger}}}),/INVALID_EFFECTS/);
 assert.equal((await getSnapshot(rpc,host,event)).admins!.length,2);
});
test('public authorized snapshots omit administrator lists while owner/admin snapshots retain safe display names',async()=>{
 const event=await fixture();await change(event,'addAdministrator',player);const snapshot=await getSnapshot(rpc,host,event),definition=String(snapshot.event!.definition_id);
 await command(db,{event,command:'publishTournament',revision:Number(snapshot.event!.revision),effects:{definition:{id:definition,status:'published',definition:snapshot.definitions[0].definition},event:{modular_state:'registration_open'}}});
 assert.equal((await getSnapshot(rpc,{id:player,clientId:'web'},event)).admins!.length,2);
 const outsider=await getSnapshot(rpc,{id:stranger,clientId:'web'},event);assert.equal(outsider.admins,undefined);
 assert.ok((await getSnapshot(rpc,host,event)).admins!.every(row=>!Object.hasOwn(row,'email')));
});
test('removing an administrator immediately denies their connector reads, commands and cached operation recovery',async()=>{
 const event=await fixture();await change(event,'addAdministrator',player);let snapshot=await getSnapshot(rpc,host,event);const definition=String(snapshot.event!.definition_id);
 await command(db,{event,command:'publishTournament',revision:Number(snapshot.event!.revision),effects:{definition:{id:definition,status:'published',definition:snapshot.definitions[0].definition},event:{modular_state:'registration_open'}}});
 const grantId=randomUUID();await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,player,'synthetic-test','connector',['admin:manage']]);
 const actor={id:player,clientId:'connector',grantId,permissions:['admin:manage']};snapshot=await getSnapshot(rpc,actor,event);
 const input={operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{}};
 const receipt=await executeCommand(rpc,actor,'closeRegistration',event,input);assert.deepEqual(await getOperation(rpc,actor,input.operation_id),receipt);
 await change(event,'removeAdministrator',player);
 await assert.rejects(getSnapshot(rpc,actor,event),{code:'FORBIDDEN'});await assert.rejects(executeCommand(rpc,actor,'closeRegistration',event,input),{code:'FORBIDDEN'});await assert.rejects(getOperation(rpc,actor,input.operation_id),{code:'FORBIDDEN'});
});
test('connector role changes require new owner scope and revoke cached receipts with the grant',async()=>{
 const event=await fixture(),grantId=randomUUID(),oldGrant=randomUUID();
 for(const [id,permissions] of [[grantId,['owner:manage']],[oldGrant,['admin:manage']]] as const)await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[id,owner,'synthetic-test','connector',[...permissions]]);
 const actor={id:owner,clientId:'connector',grantId,permissions:['owner:manage']};
 await assert.rejects(change(event,'addAdministrator',player,{...actor,grantId:oldGrant,permissions:['admin:manage','owner:manage']}),{code:'FORBIDDEN'});
 const added=await change(event,'addAdministrator',player,actor);assert.deepEqual(await getOperation(rpc,actor,added.input.operation_id),added.receipt);
 await change(event,'removeAdministrator',player,actor);
 await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grantId]);
 await assert.rejects(executeCommand(rpc,actor,'addAdministrator',event,added.input),{code:'GRANT_REVOKED'});
 assert.equal((await getSnapshot(rpc,host,event)).admins!.length,1);
});
