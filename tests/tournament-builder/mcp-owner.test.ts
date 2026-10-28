import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { callTournamentTool, createTournamentMcpServer, type McpDependencies } from '../../lib/tournament-builder/mcp';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewOwnerAction } from '../../lib/tournament-builder/owner-actions';
import { DomainError } from '../../lib/tournament-builder/requests';

const id=randomUUID(), actor={id:randomUUID(),clientId:'claude',permissions:['owner:manage']};
function setup(){
 const snapshot:CommandSnapshot={event:{id,created_by:actor.id,modular_state:'active',revision:7},definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[],admins:[]};
 const calls:{command:string;id:string|null;input:unknown}[]=[];
 const dependencies:McpDependencies={
  execute:async(command,id,input)=>{const envelope=input as {data:Record<string,unknown>};const plan=planCommand(snapshot,actor,command,envelope.data,{now:'2026-10-28T23:00:00Z',id:randomUUID});calls.push({command,id,input});return plan.result;},
  getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({}),
  owner:{snapshot:async()=>snapshot,findPlayer:async(_id,username)=>({id:randomUUID(),username}),previewAction:async(_id,action,data)=>previewOwnerAction(snapshot,actor,action,data)},
 };
 return {snapshot,calls,dependencies};
}
test('owner tool discovery is separate from draft and routine administrator permission',async()=>{
 const {dependencies}=setup(),server=createTournamentMcpServer(dependencies),client=new Client({name:'owner-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 await Promise.all([server.connect(a),client.connect(b)]);
 try{
  const tools=(await client.listTools()).tools;
  assert.deepEqual(tools.filter(t=>t.name.startsWith('owner_')).map(t=>t.name).sort(),['owner_commit_action','owner_find_player','owner_get_tournament','owner_preview_action']);
  assert.equal(tools.some(t=>t.name.startsWith('admin_')),false);
  const capabilities=await callTournamentTool('get_capabilities',{},dependencies) as {participant_enrollment:{ai_can_enroll:boolean};owner_actions:{available:boolean;instructions:string;actions:string[]}};
  assert.equal(capabilities.participant_enrollment.ai_can_enroll,false);
  assert.equal(capabilities.owner_actions.available,true);assert.match(capabilities.owner_actions.instructions,/confirm/i);
  assert.ok(capabilities.owner_actions.actions.includes('addAdministrator'));
  const draft={...dependencies,owner:undefined};
  await assert.rejects(callTournamentTool('owner_get_tournament',{tournament_id:id},draft),{code:'INVALID_REQUEST'});
  assert.equal((await callTournamentTool('get_capabilities',{},draft) as {owner_actions:{available:boolean}}).owner_actions.available,false);
 }finally{await client.close();await server.close();}
});
test('owner preview is read only and exact confirmed proposal uses normal command envelope',async()=>{
 const {dependencies,calls}=setup(),data={reason:' Stop this event '};
 const preview=await callTournamentTool('owner_preview_action',{tournament_id:id,action:'cancelTournament',data},dependencies) as ReturnType<typeof previewOwnerAction>;
 assert.equal(calls.length,0);assert.deepEqual(preview.data,{reason:'Stop this event'});assert.equal(preview.event_revision,7);
 const operationId=randomUUID();
 await callTournamentTool('owner_commit_action',{tournament_id:id,action:'cancelTournament',data:preview.data,expected_revision:7,operation_id:operationId,confirmed_owner_action:true,reviewed_action_hash:preview.preview_hash},dependencies);
 assert.deepEqual(calls,[{command:'cancelTournament',id,input:{operation_id:operationId,expected_revision:7,data:{reason:'Stop this event',confirmed_owner_action:true,reviewed_action_hash:preview.preview_hash}}}]);
});
test('owner boundary rejects missing confirmation, identity injection, unsupported actions and stale proofs',async()=>{
 const {dependencies,calls,snapshot}=setup(),data={reason:'Stop this event'};
 const preview=await callTournamentTool('owner_preview_action',{tournament_id:id,action:'cancelTournament',data},dependencies) as ReturnType<typeof previewOwnerAction>;
 const input={tournament_id:id,action:'cancelTournament',data,operation_id:randomUUID(),expected_revision:7,confirmed_owner_action:true,reviewed_action_hash:preview.preview_hash};
 for(const args of [{...input,confirmed_owner_action:false},{...input,reviewed_action_hash:'invalid'},{...input,actor_id:actor.id},{...input,data:{...data,actor_id:actor.id}},{...input,action:'attestScore'}])await assert.rejects(callTournamentTool('owner_commit_action',args,dependencies),DomainError);
 assert.equal(calls.length,0);
 snapshot.event!.revision=8;
 await assert.rejects(callTournamentTool('owner_commit_action',input,dependencies),{code:'STALE_PREVIEW'});
 snapshot.event!.revision=7;snapshot.event!.created_by=randomUUID();
 await assert.rejects(callTournamentTool('owner_preview_action',{tournament_id:id,action:'cancelTournament',data},dependencies),{code:'FORBIDDEN'});
 await assert.rejects(callTournamentTool('owner_commit_action',input,dependencies),{code:'FORBIDDEN'});
 assert.equal(calls.length,0);
});
test('owner username lookup accepts only exact usernames and normalizes case',async()=>{
 const {dependencies}=setup();
 const found=await callTournamentTool('owner_find_player',{tournament_id:id,username:'Existing_Player'},dependencies) as {username:string};assert.equal(found.username,'existing_player');
 await assert.rejects(callTournamentTool('owner_find_player',{tournament_id:id,username:'%any%'},dependencies));
});
