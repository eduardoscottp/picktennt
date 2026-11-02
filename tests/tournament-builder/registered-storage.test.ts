import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { previewRevision } from '../../lib/tournament-builder/revisions';
import { planCommand } from '../../lib/tournament-builder/commands';
import { callTournamentTool, type McpDependencies } from '../../lib/tournament-builder/mcp';
import { individualRoster } from '../../lib/tournament-builder/individual-roster';
let db: PGlite;
const fourth = randomUUID();
before(async()=>{db=await storageDatabase();await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[fourth,'fourth@example.invalid']);});
after(async()=>{await db?.close();});
const rpc: RpcClient = { async rpc(name,args) { try { const keys=Object.keys(args);const result=await role(db,'service_role',owner,()=>db.query<{value:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v)));return {data:result.rows[0].value,error:null}; } catch(error) {return {data:null,error:{message:String(error)}};} } };
const host={id:owner,clientId:'web'};

for (const doubles of [false,true]) test(`IDD-7 ${doubles?'Doubles':'Singles'} MCP identity, explicit positions, release, removal, replay and lock traverse SQL`, async()=>{
 const f=await fixture(doubles,2,true);
 const grantId=randomUUID(),actor={id:player,clientId:'participant-test',grantId,permissions:['player:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,player,'synthetic-test',actor.clientId,actor.permissions]);
 const deps:McpDependencies={permissions:actor.permissions,player:{snapshot:id=>getSnapshot(rpc,actor,id)},execute:(name,id,input)=>executeCommand(rpc,actor,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({})};
 const input={tournament_id:f.event,operation_id:randomUUID(),expected_revision:f.revision(),data:{definition_id:f.definitionId,consent:true,slot_index:1,position:doubles?2:1}};
 await assert.rejects(callTournamentTool('player_join_tournament',{...input,data:{...input.data,user_id:stranger}},deps),{code:'INVALID_REQUEST'});
 const receipt=await callTournamentTool('player_join_tournament',input,deps);
 assert.deepEqual(await callTournamentTool('player_join_tournament',input,deps),receipt);
 let snapshot=await getSnapshot(rpc,host,f.event);
 const roster=individualRoster(snapshot)!;
 assert.equal(roster.slots[0].positions[doubles?1:0].profile_id,player);
 if(doubles) {
  await executeCommand(rpc,{id:stranger,clientId:'web'},'joinTournament',f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{definition_id:f.definitionId,consent:true,slot_index:1,position:1}});
  snapshot=await getSnapshot(rpc,host,f.event);
  assert.equal(snapshot.team_members.filter(m=>m.membership_status==='active').length,2);
 }
 const run=async(name:string,data:Record<string,unknown>)=>{snapshot=await getSnapshot(rpc,host,f.event);return executeCommand(rpc,host,name,f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data});};
 await assert.rejects(()=>executeCommand(rpc,actor,'removeRegisteredPlayer',f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{user_id:stranger,release_only:false}}),{code:'FORBIDDEN'});
 await run('removeRegisteredPlayer',{user_id:player,release_only:true});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.tournament_players.find(p=>p.user_id===player)?.status,'approved');
 assert.equal(snapshot.team_members.filter(m=>m.user_id===player&&m.membership_status==='active').length,0);
 if(doubles) assert.equal(individualRoster(snapshot)!.slots[0].positions[0].profile_id,stranger);
 await run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:doubles?2:1});
 await run('removeRegisteredPlayer',{user_id:player,release_only:true});
 await run('placeRegisteredPlayer',{user_id:player,slot_index:2,position:1});
 snapshot=await getSnapshot(rpc,host,f.event);
 const removal={operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{user_id:player,release_only:false}};
 const removed=await executeCommand(rpc,host,'removeRegisteredPlayer',f.event,removal);
 assert.deepEqual(await executeCommand(rpc,host,'removeRegisteredPlayer',f.event,removal),removed);
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.tournament_players.find(p=>p.user_id===player)?.status,'rejected');
 if(doubles) assert.equal(snapshot.tournament_players.find(p=>p.user_id===stranger)?.status,'approved');
 await run('closeRegistration',{});
 await assert.rejects(()=>run('placeRegisteredPlayer',{user_id:stranger,slot_index:2}),{code:'INVALID_STATE'});
 await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grantId]);
 await assert.rejects(callTournamentTool('player_get_tournament',{tournament_id:f.event},deps),{code:'GRANT_REVOKED'});
});
async function fixture(doubles=false, capacity=2, individualSlots=false) {
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
 definition.registration={...definition.registration,entry_type:doubles?'fixed_doubles':'singles',partner_consent:doubles&&!individualSlots,mode:'approval',min_entries:2,max_entries:capacity,closes_at:'2030-11-06T18:00:00-05:00'};
 definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
 const created=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition}});
 const event=created.tournament_id;let revision=created.revision;
 const run=async(command:string,data:Record<string,unknown>={})=>{const result=await executeCommand(rpc,host,command,event,{operation_id:randomUUID(),expected_revision:revision,data});revision=result.revision;return result;};
 const preview=await previewTournament(rpc,host,event);await run('publishTournament',{reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]});
 const snapshot=await getSnapshot(rpc,host,event);
 const join=async(userId:string)=>{const result=await executeCommand(rpc,{id:userId,clientId:'web'},'joinTournament',event,{operation_id:randomUUID(),expected_revision:revision,data:{definition_id:snapshot.event!.definition_id,consent:true}});revision=result.revision;};
 return {event,definitionId:String(snapshot.event!.definition_id),run,join,revision:()=>revision};
}

test('individual removal cannot alter another player or rewrite generated fixtures', async()=>{
 const f=await fixture(false,2,true);
 await f.join(player); await f.join(stranger);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 await f.run('placeRegisteredPlayer',{user_id:stranger,slot_index:2,position:1});
 let snapshot=await getSnapshot(rpc,host,f.event);
 const unrelated=snapshot.team_members.find(m=>m.user_id===stranger)!;
 await assert.rejects(command(db,{event:f.event,command:'removeRegisteredPlayer',revision:f.revision(),request:{user_id:player,release_only:false},effects:{team_members:[{id:unrelated.id,membership_status:'cancelled'}]}}),/INVALID_EFFECTS/);
 assert.deepEqual(await getSnapshot(rpc,host,f.event),snapshot);
 await f.run('closeRegistration');
 await f.run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.ok(snapshot.matches.length);
 for(const [name,data] of [['removeRegisteredPlayer',{user_id:player,release_only:false}],['placeRegisteredPlayer',{user_id:player,slot_index:2,position:1}]] as const) await assert.rejects(f.run(name,data),{code:'INVALID_STATE'});
 assert.deepEqual(await getSnapshot(rpc,host,f.event),snapshot);
});
for(const doubles of [false,true])test(`real SQL completes administrator-registered ${doubles?'doubles':'singles'} with real profiles and untouched personal consent`,async()=>{
 const f=await fixture(doubles);const before=(await db.query('SELECT count(*) n FROM auth.users')).rows[0];
 if(doubles) for(const userId of [owner,player,stranger,fourth]) await f.join(userId);
 const payload={definition_id:f.definitionId,player_ids:doubles?[owner,player]:[player],entry_name:'Account entry A',reason:'Administrator registered existing profiles.'};
 const operation={operation_id:randomUUID(),expected_revision:f.revision(),data:payload};
 const first=await executeCommand(rpc,host,'addRegisteredEntry',f.event,operation);assert.deepEqual(await executeCommand(rpc,host,'addRegisteredEntry',f.event,operation),first);
 let snapshot=await getSnapshot(rpc,host,f.event);
 const second=await executeCommand(rpc,host,'addRegisteredEntry',f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{...payload,player_ids:doubles?[stranger,fourth]:[stranger],entry_name:'Account entry B'}});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.teams.length,2);assert.equal(snapshot.team_members.length,doubles?4:2);
 if(doubles) assert.deepEqual(snapshot.teams.map(team=>Number(team.registration_slot)).sort(),[1,2]);
 assert.ok(snapshot.team_members.every(member=>member.admission_source==='administrator'&&member.consented_at===null&&member.consented_definition_id===null));
 assert.ok(snapshot.teams.every(team=>team.admin_definition_id===f.definitionId&&team.registered_by===owner));
 let revision=second.revision;
 const run=async(command:string,data:Record<string,unknown>={})=>{const result=await executeCommand(rpc,host,command,f.event,{operation_id:randomUUID(),expected_revision:revision,data});revision=result.revision;return result;};
 await run('closeRegistration');await run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});await run('startTournament');
 snapshot=await getSnapshot(rpc,host,f.event);await run('attestScore',{match_id:snapshot.matches[0].id,score_a:11,score_b:5,outcome_kind:'played',reason:'Administrator validated result.'});
 snapshot=await getSnapshot(rpc,host,f.event);assert.equal(snapshot.event!.modular_state,'completed');
 assert.equal((snapshot.stages.find(stage=>stage.module_id==='placements')!.output as {groups:unknown[]}).groups.length,2);
 assert.deepEqual((await db.query('SELECT count(*) n FROM auth.users')).rows[0],before);
});
test('SQL independently verifies profile existence and rejects forged administrator metadata outside registered enrollment',async()=>{
 const f=await fixture();const team=randomUUID(),member=randomUUID(),missing=randomUUID();
 const request={definition_id:f.definitionId,player_ids:[missing],entry_name:'Missing account',reason:'Must not create identities.'};
 const effects={event:{roster_revision:1},teams:[{id:team,name:request.entry_name,entry_state:'approved',admin_definition_id:f.definitionId,registered_by:owner}],team_members:[{id:member,team_id:team,user_id:missing,membership_status:'active',admission_source:'administrator',consented_at:null,consented_definition_id:null}],tournament_players:[{id:randomUUID(),user_id:missing,status:'approved',joined_via:'link'}]};
 await assert.rejects(command(db,{event:f.event,command:'addRegisteredEntry',revision:f.revision(),request,effects}),/ACCOUNT_REQUIRED/);
 await assert.rejects(command(db,{event:f.event,command:'closeRegistration',revision:f.revision(),effects:{event:{modular_state:'registration_closed'},teams:[{id:team,admin_definition_id:f.definitionId,registered_by:owner}]}}),/INVALID_EFFECTS/);
 const snapshot=await getSnapshot(rpc,host,f.event);assert.equal(snapshot.teams.length,0);assert.equal(snapshot.event!.revision,f.revision());
});
function enrollment(f: Awaited<ReturnType<typeof fixture>>, ids: string[], revision=f.revision(), rosterRevision=0) {
 const team=randomUUID();return {event:f.event,command:'addRegisteredEntry',operation:randomUUID(),revision,request:{definition_id:f.definitionId,player_ids:ids,entry_name:'Registered boundary',reason:'Enrolled existing accounts'},effects:{event:{roster_revision:rosterRevision+1},teams:[{id:team,name:'Registered boundary',entry_state:'approved',admin_definition_id:f.definitionId,registered_by:owner}],team_members:ids.map(user_id=>({id:randomUUID(),team_id:team,user_id,membership_status:'active',admission_source:'administrator',consented_at:null as string|null,consented_definition_id:null as string|null})),tournament_players:ids.map(user_id=>({id:randomUUID(),user_id,status:'approved',joined_via:'link'}))}};
}
test('SQL rejects forged consent, source, substituted profiles and reused member/projection identities',async()=>{
 const f=await fixture(true);
 for(const userId of [owner,player]) await f.join(userId);
 for(const change of [
  (input:ReturnType<typeof enrollment>)=>{input.effects.team_members[0].consented_at=new Date().toISOString();},
  (input:ReturnType<typeof enrollment>)=>{input.effects.team_members[0].consented_definition_id=f.definitionId;},
  (input:ReturnType<typeof enrollment>)=>{input.effects.team_members[0].admission_source='self';},
  (input:ReturnType<typeof enrollment>)=>{input.effects.team_members[0].user_id=stranger;},
  (input:ReturnType<typeof enrollment>)=>{input.effects.team_members[1].id=input.effects.team_members[0].id;},
  (input:ReturnType<typeof enrollment>)=>{input.effects.tournament_players[1].id=input.effects.tournament_players[0].id;},
 ]){const input=enrollment(f,[owner,player]);Object.assign(input.effects.teams[0],{registration_slot:1});change(input);await assert.rejects(command(db,input),/INVALID_EFFECTS/);}
 const snapshot=await getSnapshot(rpc,host,f.event);assert.equal(snapshot.teams.length,0);assert.equal(snapshot.event!.revision,f.revision());
});

test('Doubles SQL and backend reject unjoined profiles before allocating a roster slot',async()=>{
 const f=await fixture(true);
 const data={definition_id:f.definitionId,player_ids:[owner,player],entry_name:'Unjoined profiles',reason:'Must join first'};
 await assert.rejects(()=>f.run('addRegisteredEntry',data),{code:'NOT_REGISTERED'});
 const forged=enrollment(f,[owner,player]);Object.assign(forged.effects.teams[0],{registration_slot:1});
 await assert.rejects(command(db,forged),/NOT_REGISTERED/);
 await f.join(owner);
 await assert.rejects(()=>f.run('addRegisteredEntry',data),{code:'NOT_REGISTERED'});
 await f.join(player);
 await f.run('addRegisteredEntry',data);
 const snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.teams[0].registration_slot,1);
 assert.equal(snapshot.tournament_players.length,2);
});
test('SQL rejects nonadmins, stale/cross-event definition requests and duplicate active or pending membership',async()=>{
 const f=await fixture(),foreign=await fixture();
 await assert.rejects(command(db,{...enrollment(f,[player]),actor:player}),/FORBIDDEN/);
 const stale=enrollment(f,[player]);stale.request.definition_id=foreign.definitionId;await assert.rejects(command(db,stale),/STALE_PREVIEW/);
 const forged=enrollment(f,[player]);forged.effects.teams[0].admin_definition_id=foreign.definitionId;await assert.rejects(command(db,forged),/INVALID_EFFECTS/);
 await f.run('requestEntry',{definition_id:f.definitionId,consent:true,entry_name:'Pending self-entry'});
 await assert.rejects(command(db,enrollment(f,[owner])),/DUPLICATE_ENTRY/);
 const other=await fixture();await other.run('addRegisteredEntry',{definition_id:other.definitionId,player_ids:[player],entry_name:'Already active',reason:'Registered profile'});
 const snapshot=await getSnapshot(rpc,host,other.event);await assert.rejects(command(db,enrollment(other,[player],other.revision(),Number(snapshot.event!.roster_revision))),/DUPLICATE_ENTRY/);
});
test('SQL capacity and revision fence competing registered admissions at the last slot',async()=>{
 const f=await fixture();await f.run('addRegisteredEntry',{definition_id:f.definitionId,player_ids:[player],entry_name:'First profile',reason:'Administrator enrollment'});
 const snapshot=await getSnapshot(rpc,host,f.event),rev=f.revision(),roster=Number(snapshot.event!.roster_revision);
 const candidates=[enrollment(f,[owner],rev,roster),enrollment(f,[stranger],rev,roster)];
 const results=await role(db,'service_role',owner,()=>Promise.allSettled(candidates.map(input=>db.query('SELECT public.tb_apply_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[owner,'web',input.operation,'b'.repeat(64),input.command,input.event,input.revision,JSON.stringify(input.request),JSON.stringify(input.effects),'{}',null]))));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const loserIndex=results.findIndex(result=>result.status==='rejected'),loser=results[loserIndex];assert.equal(loser.status,'rejected');if(loser.status==='rejected')assert.match(String(loser.reason),/STALE_REVISION/);
 await assert.rejects(command(db,enrollment(f,candidates[loserIndex].request.player_ids,rev+1,roster+1)),/CAPACITY_FULL/);
 const after=await getSnapshot(rpc,host,f.event);assert.equal(after.teams.length,2);assert.equal(after.event!.revision,rev+1);
 assert.equal(Number((await db.query<{n:number}>('SELECT count(*) n FROM tournament_operations WHERE operation_id=$1',[candidates[loserIndex].operation])).rows[0].n),0);
});
test('actual SQL cancellation rejects administrator-enrolled player projections for singles and doubles',async()=>{
 for(const doubles of [false,true]){
  const f=await fixture(doubles);
  if(doubles) for(const userId of [player,stranger]) await f.join(userId);
  await f.run('addRegisteredEntry',{definition_id:f.definitionId,player_ids:doubles?[player,stranger]:[player],entry_name:'Administrative entry',reason:'Owner registered actual accounts'});
  let snapshot=await getSnapshot(rpc,host,f.event);const team=snapshot.teams[0];
  await executeCommand(rpc,{id:player,clientId:'web'},'cancelEntry',f.event,{operation_id:randomUUID(),expected_revision:f.revision(),data:{entry_id:team.id}});
  snapshot=await getSnapshot(rpc,host,f.event);assert.equal(snapshot.teams[0].entry_state,'cancelled');assert.ok(snapshot.team_members.every(member=>member.membership_status==='cancelled'&&member.consented_at===null));
  assert.equal(snapshot.tournament_players.length,doubles?2:1);assert.ok(snapshot.tournament_players.every(profile=>profile.status==='rejected'));
 }
});
test('SQL requires individual join before a slot, moves atomically, and removes a withdrawn player',async()=>{
 const f=await fixture(true,2,true);let revision=f.revision();
 const playerHost={id:player,clientId:'web'};
 const runPlayer=async(command:string,data:Record<string,unknown>)=>{const result=await executeCommand(rpc,playerHost,command,f.event,{operation_id:randomUUID(),expected_revision:revision,data});revision=result.revision;return result;};
 await assert.rejects(()=>runPlayer('selectEntrySlot',{slot_index:1}),{code:'NOT_REGISTERED'});
 await runPlayer('joinTournament',{definition_id:f.definitionId,consent:true});
 await runPlayer('selectEntrySlot',{slot_index:1});
 await runPlayer('selectEntrySlot',{slot_index:2});
 let snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.team_members.filter(member=>member.user_id===player&&member.membership_status==='active').length,1);
 assert.equal(snapshot.teams.find(team=>team.id===snapshot.team_members.find(member=>member.user_id===player&&member.membership_status==='active')?.team_id)?.registration_slot,2);
 const strangerHost={id:stranger,clientId:'web'};
 const joined=await executeCommand(rpc,strangerHost,'joinTournament',f.event,{operation_id:randomUUID(),expected_revision:revision,data:{definition_id:f.definitionId,consent:true}});revision=joined.revision;
 const placed=await executeCommand(rpc,host,'placeRegisteredPlayer',f.event,{operation_id:randomUUID(),expected_revision:revision,data:{user_id:stranger,slot_index:2}});revision=placed.revision;
 await runPlayer('cancelRegistration',{});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.tournament_players.find(profile=>profile.user_id===player)?.status,'rejected');
 assert.equal(snapshot.team_members.filter(member=>member.user_id===player&&member.membership_status==='active').length,0);
});

test('SQL preserves joined and placed Singles players when revised to historical-flag Doubles',async()=>{
 const f=await fixture(false,2);let snapshot=await getSnapshot(rpc,host,f.event);
 const run=async(actor:typeof host,name:string,data:Record<string,unknown>={})=>{
  snapshot=await getSnapshot(rpc,host,f.event);
  return executeCommand(rpc,actor,name,f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data});
 };
 await run({id:player,clientId:'web'},'joinTournament',{definition_id:f.definitionId,consent:true});
 await run({id:stranger,clientId:'web'},'joinTournament',{definition_id:f.definitionId,consent:true});
 await run({id:player,clientId:'web'},'selectEntrySlot',{slot_index:2});
 snapshot=await getSnapshot(rpc,host,f.event);const before=structuredClone(snapshot);
 const definition=structuredClone(snapshot.definitions[0].definition) as {registration:{entry_type:string;partner_consent:boolean}};
 definition.registration.entry_type='fixed_doubles';definition.registration.partner_consent=true;
 const data={definition,reason:'Switch Singles to individual Doubles'};
 const review=previewRevision(snapshot,host,data);
 await run(host,'reviseTournament',{...data,preview_hash:review.preview_hash});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.deepEqual(snapshot.tournament_players,before.tournament_players);
 assert.equal(snapshot.teams[0].registration_slot,2);
 assert.equal(snapshot.team_members[0].consented_definition_id,before.team_members[0].consented_definition_id);
 assert.equal(snapshot.matches.length,0);
 await run(host,'reopenRegistration');
 await assert.rejects(()=>run(host,'placeRegisteredPlayer',{user_id:fourth,slot_index:1}),{code:'NOT_REGISTERED'});
 await run(host,'placeRegisteredPlayer',{user_id:stranger,slot_index:2});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.team_members.filter(m=>m.membership_status==='active').length,2);
 const placed=snapshot.team_members.find(m=>m.user_id===stranger&&m.membership_status==='active')!;
 assert.equal(placed.admission_source,'administrator');
 assert.equal(placed.consented_at,null);
 assert.equal(placed.consented_definition_id,null);
});

test('SQL independently rejects revision capacity below unassigned joined players',async()=>{
 const f=await fixture(false,4);
 for(const id of [owner,player,stranger]) {
  const snapshot=await getSnapshot(rpc,host,f.event);
  await executeCommand(rpc,{id,clientId:'web'},'joinTournament',f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{definition_id:f.definitionId,consent:true}});
 }
 const snapshot=await getSnapshot(rpc,host,f.event), definition=structuredClone(snapshot.definitions[0].definition) as {registration:{max_entries:number}};
 const data={definition,reason:'Review capacity'};
 const request={...data,preview_hash:previewRevision(snapshot,host,data).preview_hash};
 const plan=planCommand(snapshot,host,'reviseTournament',request,{id:randomUUID,now:new Date().toISOString()});
 definition.registration.max_entries=2;
 assert.throws(()=>previewRevision(snapshot,host,data),{code:'CAPACITY_FULL'});
 (plan.effects.definition!.definition as typeof definition).registration.max_entries=2;
 plan.effects.event!.max_players=2;
 await assert.rejects(command(db,{event:f.event,command:'reviseTournament',revision:Number(snapshot.event!.revision),request,effects:plan.effects}),/CAPACITY_FULL/);
 assert.deepEqual(await getSnapshot(rpc,host,f.event),snapshot);
});
