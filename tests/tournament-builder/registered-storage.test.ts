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
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';
import { previewPlayerReplacement } from '../../lib/tournament-builder/player-replacement';
import { previewPlayerWithdrawal } from '../../lib/tournament-builder/player-withdrawal';
import { previewWithdrawal } from '../../lib/tournament-builder/corrections';
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
 const firstTeam = snapshot.teams.find(team => Number(team.registration_slot) === 1)!.id;
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
 assert.equal(snapshot.teams.find(team => team.id === firstTeam)?.entry_state,'approved');
 if(doubles) assert.equal(individualRoster(snapshot)!.slots[0].positions[0].profile_id,stranger);
 await run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:doubles?2:1});
 await run('removeRegisteredPlayer',{user_id:player,release_only:true});
 await run('placeRegisteredPlayer',{user_id:player,slot_index:2,position:1});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.teams.find(team => team.id === firstTeam)?.entry_state,'approved');
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

test('SQL blocks new played games with an incomplete roster but permits recorded-score validation and a walkover', async()=>{
 const f=await fixture(false,3,true);
 for(const [id,slot] of [[player,1],[stranger,2],[owner,3]] as const) { await f.join(id); await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:1}); }
 let s=await getSnapshot(rpc,host,f.event); await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event);
 const team=s.team_members.find(member=>member.user_id===player&&member.membership_status==='active')!.team_id;
 const games=s.matches.filter(match=>match.team_a_id===team||match.team_b_id===team);
 await executeCommand(rpc,host,'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:games[0].id,score_a:11,score_b:5}});
 await db.exec('BEGIN');
 try {
  await db.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)',[f.event]);
  await db.query("UPDATE public.team_members SET membership_status='withdrawn' WHERE tournament_id=$1 AND user_id=$2",[f.event,player]);
  await db.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current() AND event_id=$1',[f.event]);
  await db.exec('COMMIT');
 } catch(error) { await db.exec('ROLLBACK'); throw error; }
 s=await getSnapshot(rpc,host,f.event); const pending=s.matches.find(match=>match.id===games[1].id)!;
 for(const [name,request] of [['startMatch',{match_id:pending.id}],['submitScore',{match_id:pending.id,score_a:11,score_b:5}],['attestScore',{match_id:pending.id,outcome_kind:'played',score_a:11,score_b:5,reason:'Result'}]] as const) {
  await assert.rejects(command(db,{event:f.event,command:name,revision:Number(s.event!.revision),request,effects:{}}),/INCOMPLETE_ROSTER/);
 }
 const recorded=s.matches.find(match=>match.id===games[0].id)!;
 await executeCommand(rpc,host,'confirmScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:games[0].id,result_revision:recorded.result_revision}});
 s=await getSnapshot(rpc,host,f.event);
 const winner=pending.team_a_id===team?pending.team_b_id:pending.team_a_id;
 await executeCommand(rpc,host,'attestScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:pending.id,outcome_kind:'walkover',winner_entry_id:winner,reason:'Opponent absent'}});
 assert.equal((await getSnapshot(rpc,host,f.event)).matches.find(match=>match.id===pending.id)?.outcome_kind,'walkover');
});

test('SQL individual withdrawal preserves past scores and team, clears pending identity, and permits later placement', async()=>{
 const f=await fixture(false,3,true);
 for(const [id,slot] of [[player,1],[stranger,2],[owner,3]] as const) { await f.join(id); await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:1}); }
 let s=await getSnapshot(rpc,host,f.event); await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event); const team=s.team_members.find(member=>member.user_id===player&&member.membership_status==='active')!.team_id;
 const games=s.matches.filter(match=>match.team_a_id===team||match.team_b_id===team);
 await executeCommand(rpc,host,'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:games[0].id,score_a:11,score_b:5}});
 s=await getSnapshot(rpc,host,f.event); const submitted=s.matches.find(match=>match.id===games[0].id)!;
 await executeCommand(rpc,host,'confirmScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:submitted.id,result_revision:submitted.result_revision}});
 s=await getSnapshot(rpc,host,f.event); const pending=s.matches.find(match=>match.id===games[1].id)!;
 const field=pending.team_a_id===team?'player_a1_id':'player_b1_id';
 await db.exec('BEGIN');
 try { await db.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)',[f.event]); await db.query(`UPDATE public.matches SET ${field}=$1 WHERE id=$2`,[player,pending.id]); await db.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current() AND event_id=$1',[f.event]); await db.exec('COMMIT'); } catch(error) { await db.exec('ROLLBACK'); throw error; }
 s=await getSnapshot(rpc,host,f.event); const proposal={team_id:team,user_id:player,reason:'Player retired from tournament'}, review=previewPlayerWithdrawal(s,host,proposal);
 await assert.rejects(()=>executeCommand(rpc,{id:stranger,clientId:'web'},'withdrawPlayer',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{...proposal,preview_hash:review.preview_hash}}),{code:'FORBIDDEN'});
 const envelope={operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{...proposal,preview_hash:review.preview_hash}};
 const receipt=await executeCommand(rpc,host,'withdrawPlayer',f.event,envelope); assert.deepEqual(await executeCommand(rpc,host,'withdrawPlayer',f.event,envelope),receipt);
 s=await getSnapshot(rpc,host,f.event);
 assert.equal(s.teams.find(row=>row.id===team)?.entry_state,'approved');
 assert.equal(s.team_members.find(row=>row.user_id===player&&row.team_id===team)?.membership_status,'cancelled');
 assert.equal(s.matches.find(match=>match.id===pending.id)?.[field],null);
 const past=s.matches.find(match=>match.id===submitted.id)!; assert.equal(past.score_a,11); assert.equal(past.score_b,5); assert.ok([past.player_a1_id,past.player_b1_id].includes(player));
 assert.throws(()=>planCommand(s,host,'submitScore',{match_id:pending.id,score_a:11,score_b:5},{id:randomUUID,now:new Date().toISOString()}),{code:'INCOMPLETE_ROSTER'});
 const slot=s.teams.find(row=>row.id===team)!.registration_slot;
 await executeCommand(rpc,host,'adminFillPosition',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{user_id:fourth,slot_index:slot,position:1,reason:'Replacement after withdrawal'}});
 const after=await getSnapshot(rpc,host,f.event); assert.equal(after.team_members.find(member=>member.user_id===fourth&&member.team_id===team)?.membership_status,'active');
 assert.ok([after.matches.find(match=>match.id===submitted.id)!.player_a1_id,after.matches.find(match=>match.id===submitted.id)!.player_b1_id].includes(player));
});

test('SQL withdrawal rejects a pending teammate belonging to another team even with forged effects', async()=>{
 const f=await fixture(true,2,true);
 for(const [id,slot,pos] of [[player,1,1],[stranger,1,2],[owner,2,1],[fourth,2,2]] as const) { await f.join(id); await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:pos}); }
 let s=await getSnapshot(rpc,host,f.event); await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event); const member=s.team_members.find(row=>row.user_id===player&&row.membership_status==='active')!, team=member.team_id, match=s.matches.find(row=>row.team_a_id===team||row.team_b_id===team)!;
 const side=match.team_a_id===team?'a':'b', field=`player_${side}1_id`, other=`player_${side}2_id`;
 await db.exec('BEGIN');
 try { await db.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)',[f.event]); await db.query(`UPDATE public.matches SET ${field}=$1,${other}=$2 WHERE id=$3`,[player,owner,match.id]); await db.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current() AND event_id=$1',[f.event]); await db.exec('COMMIT'); } catch(error) { await db.exec('ROLLBACK'); throw error; }
 s=await getSnapshot(rpc,host,f.event); const playerRow=s.tournament_players.find(row=>row.user_id===player)!;
 const request={team_id:team,user_id:player,reason:'Withdraw',preview_hash:'a'.repeat(64)};
 const effects={event:{roster_revision:Number(s.event!.roster_revision)+1},team_members:[{id:member.id,membership_status:'cancelled'}],tournament_players:[{id:playerRow.id,user_id:player,status:'rejected',joined_via:playerRow.joined_via??'link',exit_reason:'withdrew',nullified_from_standings:false}],matches:[{id:match.id,[field]:null}]};
 await assert.rejects(command(db,{event:f.event,command:'withdrawPlayer',revision:Number(s.event!.revision),request,effects}),/INVALID_STATE/);
 const after=await getSnapshot(rpc,host,f.event); assert.equal(after.team_members.find(row=>row.id===member.id)?.membership_status,'active');
});

test('MCP no longer exposes automatic individual or team withdrawal, even with administrator confirmation', async()=>{
 const f=await fixture(false,2,true);
 for(const [id,slot] of [[player,1],[stranger,2]] as const) { await f.join(id); await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:1}); }
 let s=await getSnapshot(rpc,host,f.event); await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event); const team=s.team_members.find(member=>member.user_id===player&&member.membership_status==='active')!.team_id;
 const grantId=randomUUID(),actor={id:owner,clientId:'admin-withdraw-test',grantId,permissions:['admin:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,owner,'synthetic-test',actor.clientId,actor.permissions]);
 const deps:McpDependencies={permissions:actor.permissions,admin:{snapshot:id=>getSnapshot(rpc,actor,id),findPlayer:async()=>({}),previewCorrection:async()=>({}),previewWithdrawal:async()=>({}),previewPlayerWithdrawal:async(id,data)=>previewPlayerWithdrawal(await getSnapshot(rpc,actor,id),actor,data)},execute:(name,id,input)=>executeCommand(rpc,actor,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({})};
 const args={tournament_id:f.event,operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{team_id:team,entry_id:team,user_id:player,reason:'Player unavailable',preview_hash:'a'.repeat(64)},confirmed_structure_change:true};
 for(const name of ['admin_preview_player_withdrawal','admin_withdraw_player','admin_preview_withdrawal','admin_withdraw_entry']) await assert.rejects(callTournamentTool(name,args,deps),{code:'INVALID_REQUEST'});
 assert.deepEqual(await getSnapshot(rpc,host,f.event),s);
});

for (const doubles of [false,true]) test(`administrator fills an empty ${doubles?'Doubles':'Singles'} position with an unjoined account before and after registration closes`, async()=>{
 const f=await fixture(doubles,2,true);
 await f.run('adminFillPosition',{user_id:player,slot_index:1,position:1,reason:'Registered by organizer'});
 if (doubles) {
  await f.run('closeRegistration');
  await f.run('adminFillPosition',{user_id:stranger,slot_index:1,position:2,reason:'Fill vacant partner position'});
 } else {
  await f.run('closeRegistration');
  await f.run('adminFillPosition',{user_id:stranger,slot_index:2,position:1,reason:'Fill vacant position'});
 }
 const s=await getSnapshot(rpc,host,f.event);
 assert.equal(s.tournament_players.find(row=>row.user_id===stranger)?.status,'approved');
 const member=s.team_members.find(row=>row.user_id===stranger&&row.membership_status==='active')!;
 assert.equal(member.admission_source,'administrator'); assert.equal(member.consented_at,null);
 if(doubles) assert.equal(member.team_id,s.team_members.find(row=>row.user_id===player&&row.membership_status==='active')?.team_id);
 await assert.rejects(()=>f.run('adminFillPosition',{user_id:fourth,slot_index:1,position:1,reason:'Occupied'}),{code:'SLOT_FULL'});
 await assert.rejects(()=>executeCommand(rpc,{id:fourth,clientId:'web'},'adminFillPosition',f.event,{operation_id:randomUUID(),expected_revision:f.revision(),data:{user_id:fourth,slot_index:2,position:1,reason:'Not authorized'}}),{code:'FORBIDDEN'});
});

test('SQL independently rejects forged administrative placement effects and nonexistent account', async()=>{
 const f=await fixture(true,2,true); const user=randomUUID(), team=randomUUID();
 const request={user_id:user,slot_index:1,position:1,reason:'Add account'};
 const effects={event:{roster_revision:1},teams:[{id:team,name:'Team 1',entry_state:'approved',registration_slot:1,admin_definition_id:f.definitionId,registered_by:owner}],team_members:[{id:randomUUID(),team_id:team,user_id:user,membership_status:'active',admission_source:'administrator',player_slot:1,consented_at:null,consented_definition_id:null}],tournament_players:[{id:randomUUID(),user_id:user,status:'approved',joined_via:'link'}]};
 await assert.rejects(command(db,{event:f.event,command:'adminFillPosition',revision:f.revision(),request,effects}),/ACCOUNT_REQUIRED/);
 const forged={...request,user_id:player};
 await assert.rejects(command(db,{event:f.event,command:'adminFillPosition',revision:f.revision(),request:forged,effects}),/INVALID_EFFECTS/);
 assert.equal((await getSnapshot(rpc,host,f.event)).teams.length,0);
});

test('administrative readmission clears prior exit flags and reuses the existing membership', async()=>{
 const f=await fixture(true,2,true); await f.join(player);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 let s=await getSnapshot(rpc,host,f.event); const member=s.team_members.find(row=>row.user_id===player)!;
 await f.run('removeRegisteredPlayer',{user_id:player,release_only:false});
 await db.exec('ALTER TABLE public.tournament_players DISABLE TRIGGER tb_guard');
 try { await db.query("UPDATE public.tournament_players SET exit_reason='withdrew',nullified_from_standings=true WHERE tournament_id=$1 AND user_id=$2",[f.event,player]); }
 finally { await db.exec('ALTER TABLE public.tournament_players ENABLE TRIGGER tb_guard'); }
 await f.run('adminFillPosition',{user_id:player,slot_index:1,position:1,reason:'Re-admitted by organizer'});
 s=await getSnapshot(rpc,host,f.event);
 const projection=s.tournament_players.find(row=>row.user_id===player)!;
 assert.equal(projection.status,'approved'); assert.equal(projection.exit_reason,null); assert.equal(projection.nullified_from_standings,false);
 assert.equal(s.team_members.find(row=>row.user_id===player&&row.membership_status==='active')?.id,member.id);
});

test('MCP enrollment requires current admin grant and explicit confirmation', async()=>{
 const f=await fixture(true,2,true); await f.run('closeRegistration');
 const grantId=randomUUID(), actor={id:owner,clientId:'admin-fill-test',grantId,permissions:['admin:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,owner,'synthetic-test',actor.clientId,actor.permissions]);
 const deps:McpDependencies={permissions:actor.permissions,admin:{snapshot:id=>getSnapshot(rpc,actor,id),findPlayer:async()=>({}),previewCorrection:async()=>({}),previewWithdrawal:async()=>({})},execute:(name,id,input)=>executeCommand(rpc,actor,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({})};
 const args={tournament_id:f.event,operation_id:randomUUID(),expected_revision:f.revision(),data:{user_id:player,slot_index:1,position:1,reason:'Added by organizer'}};
 await assert.rejects(callTournamentTool('admin_fill_position',args,deps));
 const receipt=await callTournamentTool('admin_fill_position',{...args,confirmed_structure_change:true},deps);
 assert.deepEqual(await callTournamentTool('admin_fill_position',{...args,confirmed_structure_change:true},deps),receipt);
 assert.equal((await getSnapshot(rpc,host,f.event)).team_members.find(m=>m.user_id===player)?.admission_source,'administrator');
});

for(const [side,firstPosition] of [['a',1],['b',2]] as const) test(`SQL fills a vacancy in preassigned side ${side} position ${firstPosition} without changing history`, async()=>{
 const newPlayer=randomUUID(), extra1=randomUUID(), extra2=randomUUID();
 for(const id of [newPlayer,extra1,extra2]) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,`${id}@example.invalid`]);
 const f=await fixture(true,3,true);
 for(const [user,slot,pos] of [[player,1,1],[stranger,1,2],[owner,2,1],[fourth,2,2],[extra1,3,1],[extra2,3,2]] as const) await f.run('adminFillPosition',{user_id:user,slot_index:slot,position:pos,reason:'Initial roster'});
 let s=await getSnapshot(rpc,host,f.event); await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event); const team=s.team_members.find(row=>row.user_id===player)!.team_id;
 const match=s.matches.find(row=>row.status==='scheduled'&&(row.team_a_id===team||row.team_b_id===team))!;
 await executeCommand(rpc,{id:player,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:match.id,score_a:11,score_b:4}});
 s=await getSnapshot(rpc,host,f.event); const before=structuredClone(s.matches.find(row=>row.id===match.id)!);
 await db.exec('ALTER TABLE public.team_members DISABLE TRIGGER tb_guard');
 try { await db.query("UPDATE public.team_members SET membership_status='withdrawn' WHERE tournament_id=$1 AND user_id=$2",[f.event,stranger]); }
 finally { await db.exec('ALTER TABLE public.team_members ENABLE TRIGGER tb_guard'); }
 await db.exec('ALTER TABLE public.tournament_players DISABLE TRIGGER tb_guard');
 try { await db.query("UPDATE public.tournament_players SET status='rejected' WHERE tournament_id=$1 AND user_id=$2",[f.event,stranger]); }
 finally { await db.exec('ALTER TABLE public.tournament_players ENABLE TRIGGER tb_guard'); }
 s=await getSnapshot(rpc,host,f.event);
 const pending=s.matches.find(row=>row.status==='scheduled'&&(row.team_a_id===team||row.team_b_id===team))!;
 const other=pending.team_a_id===team?pending.team_b_id:pending.team_a_id;
 const first=`player_${side}${firstPosition}_id`, second=`player_${side}${firstPosition===1?2:1}_id`;
 await db.exec('ALTER TABLE public.matches DISABLE TRIGGER tb_guard');
 try { await db.query(`UPDATE public.matches SET team_a_id=$1,team_b_id=$2,${first}=$3 WHERE id=$4`,[side==='a'?team:other,side==='b'?team:other,player,pending.id]); }
 finally { await db.exec('ALTER TABLE public.matches ENABLE TRIGGER tb_guard'); }
 s=await getSnapshot(rpc,host,f.event);
 const fill={user_id:newPlayer,slot_index:1,position:2,reason:'Fill vacated position'};
 const planned=planCommand(s,host,'adminFillPosition',fill,{now:new Date().toISOString(),id:randomUUID});
 const forged=structuredClone(planned.effects); forged.matches![0].score_a=99;
 await assert.rejects(command(db,{event:f.event,command:'adminFillPosition',revision:Number(s.event!.revision),request:fill,effects:forged}),/INVALID_EFFECTS/);
 await db.exec('ALTER TABLE public.matches DISABLE TRIGGER tb_guard');
 try { await db.query(`UPDATE public.matches SET ${first}=$1 WHERE id=$2`,[stranger,pending.id]); }
 finally { await db.exec('ALTER TABLE public.matches ENABLE TRIGGER tb_guard'); }
 await assert.rejects(command(db,{event:f.event,command:'adminFillPosition',revision:Number(s.event!.revision),request:fill,effects:planned.effects}),/STRUCTURE_LOCKED/);
 await db.exec('ALTER TABLE public.matches DISABLE TRIGGER tb_guard');
 try { await db.query(`UPDATE public.matches SET ${first}=$1 WHERE id=$2`,[player,pending.id]); }
 finally { await db.exec('ALTER TABLE public.matches ENABLE TRIGGER tb_guard'); }
 await executeCommand(rpc,host,'adminFillPosition',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:fill});
 const after=await getSnapshot(rpc,host,f.event);
 assert.deepEqual(after.matches.find(row=>row.id===match.id),before);
 assert.equal(after.team_members.find(row=>row.user_id===newPlayer)?.membership_status,'active');
 assert.equal(after.matches.find(row=>row.id===pending.id)?.[first],player);
 assert.equal(after.matches.find(row=>row.id===pending.id)?.[second],newPlayer);
 assert.ok([before.player_a1_id,before.player_a2_id,before.player_b1_id,before.player_b2_id].includes(stranger));
});

test('individual removal cannot alter another player or rewrite generated fixtures', async()=>{
 const f=await fixture(false,2,true);
 await f.join(player); await f.join(stranger);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 await f.run('placeRegisteredPlayer',{user_id:stranger,slot_index:2,position:1});
 let snapshot=await getSnapshot(rpc,host,f.event);
 const unrelated=snapshot.team_members.find(m=>m.user_id===stranger)!;
 const playerTeam=snapshot.team_members.find(m=>m.user_id===player)!.team_id;
 await assert.rejects(command(db,{event:f.event,command:'removeRegisteredPlayer',revision:f.revision(),request:{user_id:player,release_only:false},effects:{teams:[{id:playerTeam,entry_state:'cancelled'}]}}),/INVALID_EFFECTS/);
 await assert.rejects(command(db,{event:f.event,command:'placeRegisteredPlayer',revision:f.revision(),request:{user_id:player,slot_index:2,position:1},effects:{teams:[{id:playerTeam,entry_state:'cancelled'}]}}),/INVALID_EFFECTS/);
 await assert.rejects(command(db,{event:f.event,command:'removeRegisteredPlayer',revision:f.revision(),request:{user_id:player,release_only:false},effects:{team_members:[{id:unrelated.id,membership_status:'cancelled'}]}}),/INVALID_EFFECTS/);
 assert.deepEqual(await getSnapshot(rpc,host,f.event),snapshot);
 await f.run('closeRegistration');
 await f.run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.ok(snapshot.matches.length);
 await assert.rejects(command(db,{event:f.event,command:'withdrawEntry',revision:Number(snapshot.event!.revision),request:{entry_id:playerTeam,reason:'Remove team',preview_hash:'a'.repeat(64)},effects:{teams:[{id:playerTeam,entry_state:'cancelled'}]}}),/STRUCTURE_LOCKED/);
 for(const [name,data] of [['removeRegisteredPlayer',{user_id:player,release_only:false}],['placeRegisteredPlayer',{user_id:player,slot_index:2,position:1}]] as const) await assert.rejects(f.run(name,data),{code:'INVALID_STATE'});
 assert.deepEqual(await getSnapshot(rpc,host,f.event),snapshot);
});
test('SQL team withdrawal preserves a former player who now belongs to another team', async()=>{
 const f=await fixture(false,3,true); await f.join(player); await f.join(stranger); await f.join(owner);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 await f.run('removeRegisteredPlayer',{user_id:player,release_only:true});
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:2,position:1});
 await f.run('placeRegisteredPlayer',{user_id:stranger,slot_index:1,position:1});
 await f.run('placeRegisteredPlayer',{user_id:owner,slot_index:3,position:1});
 let s=await getSnapshot(rpc,host,f.event); const team=s.teams.find(row=>row.registration_slot===1)!;
 const former=s.team_members.find(row=>row.team_id===team.id&&row.user_id===player)!;
 const playerProjection=s.tournament_players.find(row=>row.user_id===player)!;
 assert.equal(former.membership_status,'cancelled');
 await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event); const currentTeam=s.team_members.find(row=>row.user_id===player&&row.membership_status==='active')!.team_id;
 const match=s.matches.find(row=>row.status==='scheduled'&&[row.team_a_id,row.team_b_id].includes(team.id)&&[row.team_a_id,row.team_b_id].includes(currentTeam))!;
 await executeCommand(rpc,{id:player,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:match.id,score_a:11,score_b:3}});
 s=await getSnapshot(rpc,host,f.event); const request={entry_id:team.id,reason:'Team withdrew'};
 assert.throws(()=>previewWithdrawal(s,host,request),{code:'UNRESOLVED_RESULT'});
 await assert.rejects(executeCommand(rpc,host,'withdrawEntry',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{...request,preview_hash:'a'.repeat(64)}}),{code:'UNRESOLVED_RESULT'});
 assert.deepEqual(await getSnapshot(rpc,host,f.event),s);
 const submitted=s.matches.find(row=>row.id===match.id)!;
 await executeCommand(rpc,host,'confirmScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:match.id,result_revision:submitted.result_revision}});
 s=await getSnapshot(rpc,host,f.event); const accepted=s.matches.find(row=>row.id===match.id)!, reviewed=previewWithdrawal(s,host,request);
 for(const effects of [{team_members:[{id:former.id,membership_status:'withdrawn'}]},{tournament_players:[{id:playerProjection.id,status:'rejected',exit_reason:'withdrew',nullified_from_standings:true}]}]) await assert.rejects(command(db,{event:f.event,command:'withdrawEntry',revision:Number(s.event!.revision),request:{...request,preview_hash:reviewed.preview_hash},effects}),/INVALID_EFFECTS/);
 await executeCommand(rpc,host,'withdrawEntry',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{...request,preview_hash:reviewed.preview_hash}});
 const after=await getSnapshot(rpc,host,f.event);
 assert.equal(after.team_members.find(row=>row.id===former.id)?.membership_status,'cancelled');
 assert.equal(after.tournament_players.find(row=>row.id===playerProjection.id)?.status,'approved');
 assert.equal(after.team_members.find(row=>row.user_id===player&&row.team_id!==team.id)?.membership_status,'active');
 const excluded=after.matches.find(row=>row.id===match.id)!;
 assert.ok(excluded.excluded_at);
 assert.deepEqual({...excluded,excluded_at:accepted.excluded_at,updated_at:accepted.updated_at},accepted);
});
test('SQL administrator moves a joined player within and across teams without changing others', async()=>{
 const f=await fixture(true,3,true); await f.join(player); await f.join(stranger);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 await f.run('placeRegisteredPlayer',{user_id:stranger,slot_index:3,position:1});
 let s=await getSnapshot(rpc,host,f.event); const victim=s.team_members.find(row=>row.user_id===stranger&&row.membership_status==='active')!;
 const forged={team_members:[{id:victim.id,user_id:player,membership_status:'cancelled'}]};
 await assert.rejects(command(db,{event:f.event,command:'placeRegisteredPlayer',revision:f.revision(),request:{user_id:player,slot_index:2,position:1},effects:forged}),/INVALID_EFFECTS/);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:2});
 s=await getSnapshot(rpc,host,f.event); assert.equal(s.team_members.find(row=>row.user_id===player&&row.membership_status==='active')?.player_slot,2);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:2,position:1});
 s=await getSnapshot(rpc,host,f.event);
 assert.equal(s.team_members.filter(row=>row.user_id===player&&row.membership_status==='active').length,1);
 assert.equal(s.team_members.find(row=>row.id===victim.id)?.membership_status,'active');
 assert.equal(s.tournament_players.find(row=>row.user_id===player)?.status,'approved');
});
test('SQL rejects player cancellation routes after registration closes under the row lock', async()=>{
 const f=await fixture(false,2,true);
 await f.join(player);
 await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 const before=await getSnapshot(rpc,host,f.event), entry=String(before.teams[0].id);
 await f.run('closeRegistration');
 const closed=await getSnapshot(rpc,host,f.event);
 await assert.rejects(command(db,{actor:player,event:f.event,command:'cancelRegistration',revision:Number(before.event!.revision),effects:{}}),/STALE_REVISION/);
 const grantId=randomUUID(),actor={id:player,clientId:'close-test',grantId,permissions:['player:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,player,'synthetic-test',actor.clientId,actor.permissions]);
 const deps:McpDependencies={permissions:actor.permissions,player:{snapshot:id=>getSnapshot(rpc,actor,id)},execute:(name,id,input)=>executeCommand(rpc,actor,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({})};
 await assert.rejects(callTournamentTool('player_cancel_registration',{tournament_id:f.event,operation_id:randomUUID(),expected_revision:f.revision(),data:{}},deps),{code:'REGISTRATION_CLOSED'});
 for(const [name,request] of [['cancelRegistration',{}],['cancelEntry',{entry_id:entry}],['withdrawEntry',{entry_id:entry,reason:'Cannot attend'}]] as const) {
  await assert.rejects(command(db,{actor:player,event:f.event,command:name,revision:f.revision(),request,effects:{}}),/REGISTRATION_CLOSED/);
 }
 assert.deepEqual(await getSnapshot(rpc,host,f.event),closed);
});
test('same-team individual moves preserve one membership across SQL and MCP', async()=>{
 const f=await fixture(true,2,true);
 const grantId=randomUUID(),actor={id:player,clientId:'move-test',grantId,permissions:['player:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,player,'synthetic-test',actor.clientId,actor.permissions]);
 const deps:McpDependencies={permissions:actor.permissions,player:{snapshot:id=>getSnapshot(rpc,actor,id)},execute:(name,id,input)=>executeCommand(rpc,actor,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({})};
 const join={tournament_id:f.event,operation_id:randomUUID(),expected_revision:f.revision(),data:{definition_id:f.definitionId,consent:true,slot_index:1,position:1}};
 await callTournamentTool('player_join_tournament',join,deps);
 let snapshot=await getSnapshot(rpc,host,f.event);
 const member=structuredClone(snapshot.team_members.find(m=>m.user_id===player)!);
 const move={tournament_id:f.event,operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{slot_index:1,position:2}};
 const result=await callTournamentTool('player_select_position',move,deps);
 assert.deepEqual(await callTournamentTool('player_select_position',move,deps),result);
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.deepEqual(snapshot.team_members.find(m=>m.user_id===player),{...member,player_slot:2});
 assert.equal(snapshot.team_members.filter(m=>m.user_id===player&&m.membership_status==='active').length,1);
 await assert.rejects(()=>executeCommand(rpc,actor,'selectEntrySlot',f.event,{operation_id:randomUUID(),expected_revision:move.expected_revision,data:{slot_index:1,position:1}}),{code:'STALE_REVISION'});
 await executeCommand(rpc,actor,'selectEntrySlot',f.event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data:{slot_index:1,position:1}});
 snapshot=await getSnapshot(rpc,host,f.event);
 assert.equal(snapshot.team_members.find(m=>m.user_id===player)?.player_slot,1);
});
test('authorized snapshots show public avatars while MCP projections do not add profile fields', async()=>{
 await db.query("UPDATE public.profiles SET avatar_url='https://example.invalid/player-avatar.png' WHERE id=$1",[player]);
 const f=await fixture(false,2,true);
 await f.join(player);await f.run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
 const visible=await getSnapshot(rpc,{id:stranger,clientId:'web'},f.event);
 assert.equal(visible.team_members.find(m=>m.user_id===player)?.avatar_url,'https://example.invalid/player-avatar.png');
 assert.equal(visible.tournament_players.find(m=>m.user_id===player)?.avatar_url,'https://example.invalid/player-avatar.png');
 assert.doesNotMatch(JSON.stringify(publicMcpResult('player_get_tournament',visible)),/avatar_url|player-avatar\.png/);
 const grantId=randomUUID(),actor={id:player,clientId:'avatar-test',grantId,permissions:['player:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,player,'synthetic-test',actor.clientId,actor.permissions]);
 assert.doesNotMatch(JSON.stringify(await getSnapshot(rpc,actor,f.event)),/avatar_url|player-avatar\.png/);
 const audit=await db.query<{snapshot:unknown}>('SELECT tournament_builder_private.snapshot($1) snapshot',[f.event]);
 assert.doesNotMatch(JSON.stringify(audit.rows[0].snapshot),/avatar_url|player-avatar\.png/);
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
test('SQL admits an existing Picktennt replacement after fixtures without fabricating consent',async()=>{
 const f=await fixture(false,2,true);
 for(const [id,slot] of [[player,1],[stranger,2]] as const) {await f.join(id);await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:1});}
 let snapshot=await getSnapshot(rpc,host,f.event);const rosterRevision=snapshot.event!.roster_revision;
 await f.run('closeRegistration');await f.run('lockRoster',{reviewed_roster_revision:rosterRevision});
 snapshot=await getSnapshot(rpc,host,f.event);
 const team=snapshot.teams.find(t=>snapshot.team_members.some(m=>m.team_id===t.id&&m.user_id===player))!;
 const data={definition:snapshot.definitions.find(d=>d.id===snapshot.event!.definition_id)!.definition,reason:'Review replacement',entries:[{entry_id:team.id,entry_name:String(team.name),player_ids:[fourth]}]};
 const request={...data,preview_hash:previewRevision(snapshot,host,data).preview_hash};
 const plan=planCommand(snapshot,host,'reviseTournament',request,{id:randomUUID,now:new Date().toISOString()});
 await command(db,{event:f.event,command:'reviseTournament',revision:Number(snapshot.event!.revision),request,effects:plan.effects});
 const changed=await getSnapshot(rpc,host,f.event);
 assert.equal(changed.teams.find(t=>t.id===team.id)?.id,team.id);
 assert.equal(changed.tournament_players.find(p=>p.user_id===fourth)?.status,'approved');
 const member=changed.team_members.find(m=>m.team_id===team.id&&m.user_id===fourth&&m.membership_status==='active')!;
 assert.equal(member.admission_source,'administrator');assert.equal(member.consented_at,null);
});

test('replacement after a score preserves team and historical players while updating future roster',async()=>{
 const f=await fixture(false,3,true);
 for(const [id,slot] of [[player,1],[stranger,2],[owner,3]] as const) { await f.join(id); await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:1}); }
 let s=await getSnapshot(rpc,host,f.event);
 await f.run('closeRegistration'); await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision}); await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event);
 const team=s.teams.find(t=>s.team_members.some(m=>m.team_id===t.id&&m.user_id===player&&m.membership_status==='active'))!;
 const match=s.matches.find(m=>m.status==='scheduled'&&(m.team_a_id===team.id||m.team_b_id===team.id))!;
 await executeCommand(rpc,{id:player,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:match.id,score_a:11,score_b:5}});
 s=await getSnapshot(rpc,host,f.event);
 const fixedFuture=s.matches.find(m=>m.status==='scheduled'&&(m.team_a_id===team.id||m.team_b_id===team.id))!;
 const fixedField=fixedFuture.team_a_id===team.id?'player_a1_id':'player_b1_id';
 await db.exec('ALTER TABLE public.matches DISABLE TRIGGER USER');
 try { await db.query(`UPDATE public.matches SET ${fixedField}=$1 WHERE id=$2`,[player,fixedFuture.id]); }
 finally { await db.exec('ALTER TABLE public.matches ENABLE TRIGGER USER'); }
 s=await getSnapshot(rpc,host,f.event);
 const proposal={team_id:team.id,old_user_id:player,new_user_id:fourth,reason:'Replace player'};
 const preview=previewPlayerReplacement(s,host,proposal);
 assert.ok(preview.preserved_match_ids.includes(match.id));assert.ok(preview.future_match_ids.length);
 const data={...proposal,preview_hash:preview.preview_hash};
 const replacement=planCommand(s,host,'replacePlayer',data,{id:randomUUID,now:new Date().toISOString()});
 const forged=structuredClone(replacement.effects);forged.teams![0].name='Forged team';
 await assert.rejects(command(db,{event:f.event,command:'replacePlayer',revision:Number(s.event!.revision),request:data,effects:forged}),/INVALID_EFFECTS/);
 const forgedMatch=structuredClone(replacement.effects);forgedMatch.matches![0].score_a=99;
 await assert.rejects(command(db,{event:f.event,command:'replacePlayer',revision:Number(s.event!.revision),request:data,effects:forgedMatch}),/INVALID_EFFECTS/);
 await assert.rejects(command(db,{event:f.event,actor:stranger,command:'replacePlayer',revision:Number(s.event!.revision),request:data,effects:replacement.effects}),/FORBIDDEN/);
 const missing={...proposal,new_user_id:randomUUID()},missingData={...missing,preview_hash:previewPlayerReplacement(s,host,missing).preview_hash};
 const missingPlan=planCommand(s,host,'replacePlayer',missingData,{id:randomUUID,now:new Date().toISOString()});
 await assert.rejects(command(db,{event:f.event,command:'replacePlayer',revision:Number(s.event!.revision),request:missingData,effects:missingPlan.effects}),/ACCOUNT_REQUIRED/);
 const envelope={operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data};
 const receipt=await executeCommand(rpc,host,'replacePlayer',f.event,envelope);
 assert.deepEqual(await executeCommand(rpc,host,'replacePlayer',f.event,envelope),receipt);
 const after=await getSnapshot(rpc,host,f.event);
 assert.equal(after.teams.find(t=>t.id===team.id)?.id,team.id);
 assert.equal(after.team_members.find(m=>m.team_id===team.id&&m.user_id===fourth)?.membership_status,'active');
 assert.equal(after.team_members.find(m=>m.team_id===team.id&&m.user_id===player)?.membership_status,'cancelled');
 assert.equal(after.matches.find(m=>m.id===fixedFuture.id)?.[fixedField],fourth);
 const played=after.matches.find(m=>m.id===match.id)!;
 assert.ok([played.player_a1_id,played.player_b1_id].includes(player));
 assert.equal(played.score_a,11);assert.equal(played.score_b,5);
 const viewer=await getSnapshot(rpc,{id:stranger,clientId:'web'},f.event);
 const viewed=viewer.matches.find(m=>m.id===match.id)!;
 const playerSide=viewed.player_a1_id===player?'a':'b';
 assert.equal(viewed[`player_${playerSide}1_name`],'Player');
 assert.doesNotMatch(JSON.stringify(viewed),/@example\.invalid/);
 const next=after.matches.find(m=>m.status==='scheduled'&&(m.team_a_id===team.id||m.team_b_id===team.id))!;
 await executeCommand(rpc,{id:fourth,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(after.event!.revision),data:{match_id:next.id,score_a:11,score_b:5}});
 const later=await getSnapshot(rpc,host,f.event);
 const newMatch=later.matches.find(m=>m.id===next.id)!;
 assert.ok([newMatch.player_a1_id,newMatch.player_b1_id].includes(fourth));
 assert.ok([later.matches.find(m=>m.id===match.id)!.player_a1_id,later.matches.find(m=>m.id===match.id)!.player_b1_id].includes(player));
 const remaining=later.matches.find(m=>m.status==='scheduled')!;
 await executeCommand(rpc,host,'attestScore',f.event,{operation_id:randomUUID(),expected_revision:Number(later.event!.revision),data:{match_id:remaining.id,outcome_kind:'walkover',winner_entry_id:remaining.team_a_id,reason:'Opponent absent'}});
 const walkover=(await getSnapshot(rpc,host,f.event)).matches.find(m=>m.id===remaining.id)!;
 assert.ok(walkover.player_a1_id && walkover.player_b1_id);
});
test('MCP replacement requires admin grant, reviewed impact and explicit confirmation',async()=>{
 const f=await fixture(false,3,true);
 for(const [id,slot] of [[player,1],[stranger,2],[owner,3]] as const) { await f.join(id); await f.run('placeRegisteredPlayer',{user_id:id,slot_index:slot,position:1}); }
 let s=await getSnapshot(rpc,host,f.event);await f.run('closeRegistration');await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision});await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event);
 const team=s.teams.find(t=>s.team_members.some(m=>m.team_id===t.id&&m.user_id===player&&m.membership_status==='active'))!;
 const match=s.matches.find(m=>m.status==='scheduled'&&(m.team_a_id===team.id||m.team_b_id===team.id))!;
 await executeCommand(rpc,{id:player,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:match.id,score_a:11,score_b:5}});
 s=await getSnapshot(rpc,host,f.event);
 const grantId=randomUUID(),actor={id:owner,clientId:'admin-replacement-test',grantId,permissions:['admin:manage']};
 await db.query('INSERT INTO connection_grants(id,user_id,provider,client_id,permissions) VALUES($1,$2,$3,$4,$5)',[grantId,owner,'synthetic-test',actor.clientId,actor.permissions]);
 const deps:McpDependencies={permissions:actor.permissions,admin:{snapshot:id=>getSnapshot(rpc,actor,id),findPlayer:async()=>({}),previewCorrection:async()=>({}),previewWithdrawal:async()=>({}),previewPlayerReplacement:async(id,data)=>previewPlayerReplacement(await getSnapshot(rpc,actor,id),actor,data)},execute:(name,id,input)=>executeCommand(rpc,actor,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({})};
 const proposal={team_id:team.id,old_user_id:player,new_user_id:fourth,reason:'Reviewed replacement'};
 const reviewed=await callTournamentTool('admin_preview_player_replacement',{tournament_id:f.event,data:proposal},deps) as ReturnType<typeof previewPlayerReplacement>;
 assert.ok(reviewed.preserved_match_ids.includes(match.id));
 const args={tournament_id:f.event,operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{...proposal,preview_hash:reviewed.preview_hash}};
 await assert.rejects(callTournamentTool('admin_replace_player',args,deps));
 await callTournamentTool('admin_replace_player',{...args,confirmed_structure_change:true},deps);
 const after=await getSnapshot(rpc,host,f.event);
 assert.equal(after.team_members.find(m=>m.user_id===fourth&&m.team_id===team.id)?.membership_status,'active');
 assert.ok([after.matches.find(m=>m.id===match.id)!.player_a1_id,after.matches.find(m=>m.id===match.id)!.player_b1_id].includes(player));
});
test('Doubles replacement keeps teammate and historical players while the same team continues',async()=>{
 const extra=[randomUUID(),randomUUID(),randomUUID()];
 for(const id of extra) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,`${id}@example.invalid`]);
 const participants=[player,stranger,owner,...extra], f=await fixture(true,3,true);
 for(let i=0;i<participants.length;i++){await f.join(participants[i]);await f.run('placeRegisteredPlayer',{user_id:participants[i],slot_index:Math.floor(i/2)+1,position:i%2+1});}
 let s=await getSnapshot(rpc,host,f.event);await f.run('closeRegistration');await f.run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision});await f.run('startTournament');
 s=await getSnapshot(rpc,host,f.event);
 const team=s.teams.find(t=>s.team_members.some(m=>m.team_id===t.id&&m.user_id===player&&m.membership_status==='active'))!;
 const match=s.matches.find(m=>m.status==='scheduled'&&(m.team_a_id===team.id||m.team_b_id===team.id))!;
 await executeCommand(rpc,{id:player,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data:{match_id:match.id,score_a:11,score_b:5}});
 s=await getSnapshot(rpc,host,f.event);
 const proposal={team_id:team.id,old_user_id:player,new_user_id:fourth,reason:'Reviewed Doubles replacement'};
 const data={...proposal,preview_hash:previewPlayerReplacement(s,host,proposal).preview_hash};
 await executeCommand(rpc,host,'replacePlayer',f.event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data});
 const after=await getSnapshot(rpc,host,f.event), current=after.team_members.filter(m=>m.team_id===team.id&&m.membership_status==='active');
 assert.deepEqual(current.map(m=>m.user_id).sort(),[stranger,fourth].sort());
 const played=after.matches.find(m=>m.id===match.id)!, oldPlayers=played.team_a_id===team.id?[played.player_a1_id,played.player_a2_id]:[played.player_b1_id,played.player_b2_id];
 assert.deepEqual(oldPlayers.sort(),[player,stranger].sort());
 const next=after.matches.find(m=>m.status==='scheduled'&&(m.team_a_id===team.id||m.team_b_id===team.id))!;
 await executeCommand(rpc,{id:fourth,clientId:'web'},'submitScore',f.event,{operation_id:randomUUID(),expected_revision:Number(after.event!.revision),data:{match_id:next.id,score_a:11,score_b:5}});
 const future=(await getSnapshot(rpc,host,f.event)).matches.find(m=>m.id===next.id)!, newPlayers=future.team_a_id===team.id?[future.player_a1_id,future.player_a2_id]:[future.player_b1_id,future.player_b2_id];
 assert.deepEqual(newPlayers.sort(),[fourth,stranger].sort());
});
