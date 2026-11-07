import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, getOperation, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import type { CommandActor } from '../../lib/tournament-builder/commands';
import { previewBulkOperation } from '../../lib/tournament-builder/bulk-adjudication';
import { callTournamentTool, type McpDependencies } from '../../lib/tournament-builder/mcp';
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
async function fixture(publish=true,userId=owner,entries=2,playoffs=false){
 const host={id:userId,clientId:'web'};
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
 definition.registration={...definition.registration,entry_type:'singles',partner_consent:false,mode:'approval',min_entries:entries,max_entries:entries,closes_at:'2030-11-06T18:00:00-05:00'};
 if(!playoffs)definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
 const created=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition}});
 const event=created.tournament_id;let revision=created.revision;
 const run=async(command:string,data:Record<string,unknown>={},actor:CommandActor=host)=>{const receipt=await executeCommand(rpc,actor,command,event,{operation_id:randomUUID(),expected_revision:revision,data});revision=receipt.revision;return receipt;};
 const preview=await previewTournament(rpc,host,event),publishData={reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]};
 if(publish)await run('publishTournament',publishData);
 const snapshot=await getSnapshot(rpc,host,event);
 return {event,host,run,publishData,definitionId:String(snapshot.event!.definition_id),revision:()=>revision};
}
test('v1 round robin bulk adjudication traverses MCP, grant, planner and atomic SQL with idempotent history',async()=>{
 const administrator=await connector(),f=await fixture(true,owner,3);
 for(const profileId of [player,stranger,owner])await f.run('addRegisteredEntry',registration(f,profileId),administrator);
 const roster=await getSnapshot(rpc,administrator,f.event);
 await f.run('closeRegistration',{},administrator);await f.run('lockRoster',{reviewed_roster_revision:roster.event!.roster_revision},administrator);await f.run('startTournament',{},administrator);
 let current=await getSnapshot(rpc,administrator,f.event);
 const entry=String(current.matches[0].team_a_id),games=current.matches.filter(match=>[match.team_a_id,match.team_b_id].includes(entry));
 await f.run('attestScore',{match_id:games[0].id,outcome_kind:'played',score_a:11,score_b:0,reason:'Observed score'},administrator);
 current=await getSnapshot(rpc,administrator,f.event);
 const proposal={entry_id:entry,match_ids:games.map(match=>match.id),mode:'score',winner_score:11,loser_score:0,reason:'Administrative correction',overwrite_existing:true,regenerate_downstream:false};
 const deps:McpDependencies={execute:(name,id,input)=>executeCommand(rpc,administrator,name,id,input),getDraft:async()=>({}),preview:async()=>({}),operation:async()=>({}),reviewLink:async()=>({}),admin:{snapshot:id=>getSnapshot(rpc,administrator,id),findPlayer:async()=>({}),previewCorrection:async()=>({}),previewWithdrawal:async()=>({}),previewBulkOperation:async(id,data)=>previewBulkOperation(await getSnapshot(rpc,administrator,id),administrator,data)}};
 const preview=await callTournamentTool('admin_preview_bulk_adjudication',{tournament_id:f.event,data:proposal},deps) as {preview_hash:string};
 const args={tournament_id:f.event,operation_id:randomUUID(),expected_revision:Number(current.event!.revision),data:{...proposal,preview_hash:preview.preview_hash},confirmed_structure_change:true};
 const receipt=await callTournamentTool('admin_commit_bulk_adjudication',args,deps);
 assert.deepEqual(await callTournamentTool('admin_commit_bulk_adjudication',args,deps),receipt);
 const result=await getSnapshot(rpc,administrator,f.event);
 assert.ok(games.every(game=>result.matches.find(match=>match.id===game.id)?.outcome_kind==='administrative_score'));
 assert.ok(games.every(game=>result.matches.find(match=>match.id===game.id)?.submit_to_dupr===false));
 assert.ok(result.standings.some(standing=>standing.team_id===entry&&Number(standing.losses)===2));
 const history=await db.query<{before_facts:{matches:{id:string;outcome_kind:string}[]};after_facts:{matches:{id:string;outcome_kind:string}[]}}>('SELECT before_facts,after_facts FROM tournament_operations WHERE operation_id=$1',[args.operation_id]);
 assert.equal(history.rows[0].before_facts.matches.find(match=>match.id===games[0].id)?.outcome_kind,'played');
 assert.equal(history.rows[0].after_facts.matches.find(match=>match.id===games[0].id)?.outcome_kind,'administrative_score');
 const walkover={entry_id:entry,match_ids:[games[0].id],mode:'walkover',reason:'Reviewed no-show',overwrite_existing:true,regenerate_downstream:false};
 const secondPreview=await callTournamentTool('admin_preview_bulk_adjudication',{tournament_id:f.event,data:walkover},deps) as {preview_hash:string};
 await callTournamentTool('admin_commit_bulk_adjudication',{tournament_id:f.event,operation_id:randomUUID(),expected_revision:Number(result.event!.revision),data:{...walkover,preview_hash:secondPreview.preview_hash},confirmed_structure_change:true},deps);
 const saved=(await getSnapshot(rpc,administrator,f.event)).matches.find(match=>match.id===games[0].id)!;
 assert.equal(saved.outcome_kind,'walkover');assert.equal(saved.score_a,null);assert.equal(saved.score_b,null);
});
test('v1 qualification changes require reviewed playoff regeneration and preserve existing results',async()=>{
 const administrator=await connector(),f=await fixture(true,owner,4,true),fourth=randomUUID();
 await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[fourth,'bulk-fourth@example.invalid','{}']);
 for(const profileId of [player,stranger,owner,fourth])await f.run('addRegisteredEntry',registration(f,profileId),administrator);
 const roster=await getSnapshot(rpc,administrator,f.event);
 await f.run('closeRegistration',{},administrator);await f.run('lockRoster',{reviewed_roster_revision:roster.event!.roster_revision},administrator);await f.run('startTournament',{},administrator);
 let current=await getSnapshot(rpc,administrator,f.event);
 const rr=current.stages.find(stage=>stage.module_id==='round_robin')!;
 for(const game of current.matches.filter(match=>match.stage_id===rr.id)){
  const a=Number(current.teams.find(team=>team.id===game.team_a_id)!.seed),b=Number(current.teams.find(team=>team.id===game.team_b_id)!.seed);
  await f.run('attestScore',{match_id:game.id,outcome_kind:'played',score_a:a<b?11:0,score_b:a<b?0:11,reason:'Observed result'},administrator);
 }
 current=await getSnapshot(rpc,administrator,f.event);
 const elimination=current.stages.find(stage=>stage.module_id==='elimination')!;
 const semifinal=current.matches.find(match=>match.stage_id===elimination.id&&match.team_a_id&&match.team_b_id)!;
 await f.run('attestScore',{match_id:semifinal.id,outcome_kind:'played',score_a:11,score_b:0,reason:'Observed semifinal'},administrator);
 current=await getSnapshot(rpc,administrator,f.event);
 const leading=String(current.teams.find(team=>Number(team.seed)===1)!.id);
 const sourceGames=current.matches.filter(match=>match.stage_id===rr.id&&[match.team_a_id,match.team_b_id].includes(leading));
 const source=sourceGames[0];
 const third=String(current.teams.find(team=>Number(team.seed)===3)!.id);
 const tyingGame=sourceGames.find(match=>[match.team_a_id,match.team_b_id].includes(third))!;
 const tied=previewBulkOperation(current,administrator,{entry_id:leading,match_ids:[tyingGame.id],mode:'score',winner_score:11,loser_score:0,reason:'Review tie impact',overwrite_existing:true,regenerate_downstream:true});
 assert.equal(tied.blocked_code,'UNRESOLVED_TIE');
 assert.ok(tied.qualification.some(stage=>stage.state==='blocked'));
 const proposal={entry_id:leading,match_ids:sourceGames.map(match=>match.id),mode:'walkover',reason:'Reviewed team withdrawal',overwrite_existing:true,regenerate_downstream:false};
 assert.throws(()=>previewBulkOperation(current,administrator,proposal),{code:'DOWNSTREAM_STARTED'});
 const reviewed=previewBulkOperation(current,administrator,{...proposal,regenerate_downstream:true});
 assert.ok(reviewed.archived_matches.some(match=>match.match_id===semifinal.id&&match.outcome_kind==='played'));
 const receipt=await executeCommand(rpc,administrator,'bulkAdjudicate',f.event,{operation_id:randomUUID(),expected_revision:Number(current.event!.revision),data:{...proposal,regenerate_downstream:true,preview_hash:reviewed.preview_hash}});
 const result=await getSnapshot(rpc,administrator,f.event);
 assert.equal(result.event!.revision,receipt.revision);
 assert.equal(result.matches.find(match=>match.id===semifinal.id)?.is_current,false);
 assert.equal(result.matches.find(match=>match.id===source.id)?.outcome_kind,'walkover');
 assert.ok(result.matches.some(match=>match.id===semifinal.id&&match.outcome_kind==='played'),'Archived result remains in history.');
});
test('v1 elimination correction previews actual bracket successors and preserves the previous final',async()=>{
 const administrator=await connector(),f=await fixture(true,owner,4,true),fourth=randomUUID();
 await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[fourth,'elimination-fourth@example.invalid','{}']);
 for(const profileId of [player,stranger,owner,fourth])await f.run('addRegisteredEntry',registration(f,profileId),administrator);
 const roster=await getSnapshot(rpc,administrator,f.event);
 await f.run('closeRegistration',{},administrator);await f.run('lockRoster',{reviewed_roster_revision:roster.event!.roster_revision},administrator);await f.run('startTournament',{},administrator);
 let current=await getSnapshot(rpc,administrator,f.event);
 while(current.event!.modular_state!=='completed'){
  const game=current.matches.find(match=>match.is_current!==false&&match.status==='scheduled'&&match.team_a_id&&match.team_b_id)!;
  assert.ok(game);
  const a=Number(current.teams.find(team=>team.id===game.team_a_id)!.seed),b=Number(current.teams.find(team=>team.id===game.team_b_id)!.seed);
  await f.run('attestScore',{match_id:game.id,outcome_kind:'played',score_a:a<b?11:0,score_b:a<b?0:11,reason:'Observed result'},administrator);
  current=await getSnapshot(rpc,administrator,f.event);
 }
 const semifinal=current.matches.find(match=>match.bracket_next_winner_match_id)!;
 const previousFinal=current.matches.find(match=>match.id===semifinal.bracket_next_winner_match_id)!;
 await f.run('reopenResults',{reason:'Owner reviews a semifinal result.'},f.host);
 current=await getSnapshot(rpc,administrator,f.event);
 const proposal={entry_id:String(semifinal.winner_team_id),match_ids:[semifinal.id],mode:'score',winner_score:11,loser_score:0,reason:'Reviewed semifinal award',overwrite_existing:true,regenerate_downstream:false};
 assert.throws(()=>previewBulkOperation(current,administrator,proposal),{code:'DOWNSTREAM_STARTED'});
 assert.throws(()=>previewBulkOperation(current,administrator,{...proposal,match_ids:[semifinal.id,previousFinal.id]}),{code:'INVALID_STATE'});
 const reviewed=previewBulkOperation(current,administrator,{...proposal,regenerate_downstream:true});
 assert.ok(reviewed.archived_matches.some(match=>match.match_id===previousFinal.id&&match.outcome_kind==='played'));
 await executeCommand(rpc,administrator,'bulkAdjudicate',f.event,{operation_id:randomUUID(),expected_revision:Number(current.event!.revision),data:{...proposal,regenerate_downstream:true,preview_hash:reviewed.preview_hash}});
 const after=await getSnapshot(rpc,administrator,f.event);
 assert.equal(after.matches.find(match=>match.id===previousFinal.id)?.is_current,false);
 assert.equal(after.matches.find(match=>match.id===semifinal.id)?.outcome_kind,'administrative_score');
 assert.ok(after.matches.some(match=>match.logical_key===previousFinal.logical_key&&match.id!==previousFinal.id&&match.is_current!==false));
});
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
