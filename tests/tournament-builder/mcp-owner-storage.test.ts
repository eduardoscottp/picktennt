import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { storageDatabase, role, owner, player, stranger } from './helpers/storage-db';
import { callTournamentTool, type McpDependencies } from '../../lib/tournament-builder/mcp';
import { executeCommand, getSnapshot, getOperation, type RpcClient, type CommandReceipt } from '../../lib/tournament-builder/repository';
import { previewOwnerAction } from '../../lib/tournament-builder/owner-actions';

test('owner MCP actions traverse actual SQL without implicit scopes; receipts and revocation remain authoritative',async()=>{
 const db=await storageDatabase();
 const rpc:RpcClient={async rpc(name,args){
  assert.ok(['tb_get_snapshot','tb_get_operation','tb_apply_command'].includes(name));
  try{const keys=Object.keys(args),result=await role(db,'service_role',owner,()=>db.query<{value:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,Object.values(args).map(value=>value&&typeof value==='object'?JSON.stringify(value):value)));return {data:result.rows[0].value,error:null};}
  catch(error){return {data:null,error:{message:String(error)}};}
 }};
 try{
  const grantId=randomUUID(),actor={id:owner,clientId:'owner-connector',grantId,permissions:['owner:manage']},host={id:owner,clientId:'web'};
  await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,owner,'synthetic-test',actor.clientId,actor.permissions]);
  const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
  definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
  definition.registration={...definition.registration,entry_type:'singles',partner_consent:false,mode:'open',min_entries:2,max_entries:2,closes_at:'2030-11-06T18:00:00-05:00'};
  definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
  const created=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition}}),id=created.tournament_id;
  const dependencies:McpDependencies={
   execute:(command,id,input)=>executeCommand(rpc,actor,command,id,input),
   getDraft:id=>getSnapshot(rpc,actor,id),preview:async()=>({}),operation:(_id,operation)=>getOperation(rpc,actor,operation),reviewLink:async()=>({}),
   owner:{snapshot:id=>getSnapshot(rpc,actor,id),findPlayer:async()=>({}),previewAction:async(id,action,data)=>previewOwnerAction(await getSnapshot(rpc,actor,id),actor,action,data)},
  };
  const commit=async(action:string,data:Record<string,unknown>)=>{
   const preview=await callTournamentTool('owner_preview_action',{tournament_id:id,action,data},dependencies) as ReturnType<typeof previewOwnerAction>;
   const args={tournament_id:id,action,data:preview.data,operation_id:randomUUID(),expected_revision:preview.event_revision,confirmed_owner_action:true,reviewed_action_hash:preview.preview_hash};
   const receipt=await callTournamentTool('owner_commit_action',args,dependencies) as CommandReceipt;
   assert.deepEqual(await callTournamentTool('owner_commit_action',args,dependencies),receipt);
   return {receipt,args};
  };
  await assert.rejects(callTournamentTool('create_draft',{operation_id:randomUUID(),data:{definition}},dependencies),{code:'FORBIDDEN'});
  await assert.rejects(callTournamentTool('admin_close_registration',{tournament_id:id,operation_id:randomUUID(),expected_revision:1,data:{},confirmed_structure_change:true},dependencies),{code:'INVALID_REQUEST'});
  await commit('publishTournament',{});
  assert.equal((await getSnapshot(rpc,actor,id)).event!.modular_state,'registration_open');
  await commit('addAdministrator',{user_id:player,reason:'Owner delegates event assistance'});
  assert.ok((await getSnapshot(rpc,actor,id)).admins!.some(row=>row.user_id===player));
  await commit('removeAdministrator',{user_id:player,reason:'Owner ends delegated access'});
  assert.equal((await getSnapshot(rpc,actor,id)).admins!.length,1);
  const web=async(command:string,data:Record<string,unknown>={})=>{const snapshot=await getSnapshot(rpc,host,id);return executeCommand(rpc,host,command,id,{operation_id:randomUUID(),expected_revision:snapshot.event!.revision,data});};
  const definitionId=(await getSnapshot(rpc,host,id)).event!.definition_id;
  for(const profile of [player,stranger])await web('addRegisteredEntry',{definition_id:definitionId,player_ids:[profile],entry_name:`Player ${profile.slice(-1)}`,reason:'Explicit website account registration'});
  await web('closeRegistration');await web('lockRoster',{reviewed_roster_revision:(await getSnapshot(rpc,host,id)).event!.roster_revision});await web('startTournament');
  const match=(await getSnapshot(rpc,host,id)).matches[0];
  await web('attestScore',{match_id:match.id,score_a:11,score_b:5,outcome_kind:'played',reason:'Administrator validates the actual synthetic result'});
  assert.equal((await getSnapshot(rpc,actor,id)).event!.modular_state,'completed');
  await commit('reopenResults',{reason:'Owner requests completed result review'});
  const reopened=await getSnapshot(rpc,actor,id);assert.equal(reopened.event!.modular_state,'active');assert.equal(reopened.event!.results_under_review,true);assert.equal(reopened.matches[0].score_a,11);
  const cancelled=await commit('cancelTournament',{reason:'Owner ends the synthetic test tournament'});
  assert.equal((await getSnapshot(rpc,actor,id)).event!.modular_state,'cancelled');
  assert.equal((await db.query<{n:number}>('SELECT count(*) n FROM tournament_operations WHERE operation_id=$1',[cancelled.args.operation_id])).rows[0].n,1);
  await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grantId]);
  await assert.rejects(callTournamentTool('owner_get_tournament',{tournament_id:id},dependencies),{code:'GRANT_REVOKED'});
  await assert.rejects(callTournamentTool('owner_commit_action',cancelled.args,dependencies),{code:'GRANT_REVOKED'});
 }finally{await db.close();}
});
