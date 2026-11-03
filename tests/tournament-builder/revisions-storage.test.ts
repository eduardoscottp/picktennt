import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { planCommand } from '../../lib/tournament-builder/commands';
import { previewRevision } from '../../lib/tournament-builder/revisions';
import { previewSchedule } from '../../lib/tournament-builder/schedule-preview';
let db: PGlite;
before(async()=>{db=await storageDatabase();});
after(async()=>{await db?.close();});
const host={id:owner,clientId:'web'};
const rpc: RpcClient = { async rpc(name,args) { try { const keys=Object.keys(args); const result=await role(db,'service_role',owner,()=>db.query<{value:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v)));return {data:result.rows[0].value,error:null}; } catch(error) {return {data:null,error:{message:String(error)}};} } };
async function fixture() {
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
 definition.registration={...definition.registration,entry_type:'singles',partner_consent:false,mode:'approval',min_entries:2,max_entries:4,closes_at:'2030-11-06T18:00:00-05:00'};
 definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
 const created=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition}});
 const event=created.tournament_id;
 const run=async(name:string,data:Record<string,unknown>={})=>{const s=await getSnapshot(rpc,host,event);return executeCommand(rpc,host,name,event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data});};
 const preview=await previewTournament(rpc,host,event);await run('publishTournament',{reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]});
 let s=await getSnapshot(rpc,host,event);
 for(const [i,id] of [player,stranger].entries()) await run('addRegisteredEntry',{definition_id:s.event!.definition_id,player_ids:[id],entry_name:`Entry ${i}`,reason:'Existing account'});
 await run('closeRegistration');s=await getSnapshot(rpc,host,event);await run('lockRoster',{reviewed_roster_revision:s.event!.roster_revision});
 return {event,definition,run};
}
async function proposal(f:Awaited<ReturnType<typeof fixture>>, entries:unknown[]=[]){
 const snapshot=await getSnapshot(rpc,host,f.event);
 const data={definition:{...f.definition,event:{...f.definition.event,name:'Revised event'}},entries,reason:'Reviewed change'};
 const review=previewRevision(snapshot,host,data);
 const request={...data,preview_hash:review.preview_hash};
 const plan=planCommand(snapshot,host,'reviseTournament',request,{id:randomUUID,now:new Date().toISOString()});
 return {snapshot,request,plan,input:{event:f.event,command:'reviseTournament',revision:Number(snapshot.event!.revision),request,effects:plan.effects}};
}
test('real commands preserve history, publish a new definition and reuse membership rows across swaps',async()=>{
 const f=await fixture();let s=await getSnapshot(rpc,host,f.event);const prior=s.event!.definition_id,oldMatches=s.matches.map(m=>m.id),oldStages=s.stages.map(v=>v.id);
 const a=s.teams.find(t=>s.team_members.some(m=>m.team_id===t.id&&m.user_id===player))!,b=s.teams.find(t=>t.id!==a.id)!;
 const edits=[{entry_id:a.id,entry_name:'Swapped A',player_ids:[stranger]},{entry_id:b.id,entry_name:'Swapped B',player_ids:[player]}];
 const p=await proposal(f,edits);const operation=randomUUID();const input={...p.input,operation};const first=await command(db,input);assert.deepEqual(await command(db,input),first);
 s=await getSnapshot(rpc,host,f.event);assert.notEqual(s.event!.definition_id,prior);assert.equal(s.event!.modular_state,'registration_closed');
 assert.ok(s.matches.filter(m=>oldMatches.includes(m.id)).every(m=>m.is_current===false));assert.ok(s.stages.every(v=>!oldStages.includes(v.id)));
 assert.ok(s.team_members.filter(m=>m.membership_status==='active').every(m=>m.admission_source==='administrator'&&m.consented_at===null));
 assert.equal((await db.query('SELECT id FROM tournament_stages WHERE id=ANY($1::uuid[])',[oldStages])).rows.length,oldStages.length);
 await assert.rejects(command(db,{event:f.event,command:'reopenRegistration',revision:Number(s.event!.revision),effects:{event:{modular_state:'registration_open'},stages:[{id:oldStages[0],output:{tampered:true}}]}}),/HISTORICAL_STAGE/);
 const back=await proposal(f,[{entry_id:a.id,entry_name:'Original A',player_ids:[player]},{entry_id:b.id,entry_name:'Original B',player_ids:[stranger]}]);await command(db,back.input);
 assert.equal((await db.query('SELECT id FROM team_members WHERE tournament_id=$1',[f.event])).rows.length,4);
 s=await getSnapshot(rpc,host,f.event);
 await assert.rejects(command(db,{...back.input,operation:randomUUID()}),/STALE_REVISION/);
 assert.deepEqual(await getSnapshot(rpc,host,f.event),s);
 const generationData={reviewed_roster_revision:s.event!.roster_revision};const schedule=previewSchedule(s,host,generationData);
 assert.equal(previewSchedule(await getSnapshot(rpc,host,f.event),host,generationData).preview_hash,schedule.preview_hash);
 await f.run('lockRoster',{...generationData,preview_hash:schedule.preview_hash});
 const regenerated=await getSnapshot(rpc,host,f.event);const current=regenerated.matches.filter(m=>m.is_current!==false);
 assert.equal(current.length,schedule.fixtures.length);assert.ok(current.every(m=>!oldMatches.includes(m.id)&&s.stages.some(stage=>stage.id===m.stage_id)));
 assert.ok(regenerated.matches.filter(m=>oldMatches.includes(m.id)).every(m=>m.is_current===false));
});
test('removal cancels memberships without fabricating consent and forgery rolls back',async()=>{
 const f=await fixture();const s=await getSnapshot(rpc,host,f.event);const t=s.teams[0];
 const p=await proposal(f,[{entry_id:t.id,entry_name:String(t.name),player_ids:[],remove:true}]);await command(db,p.input);
 const after=await getSnapshot(rpc,host,f.event);assert.equal(after.teams.find(v=>v.id===t.id)!.entry_state,'cancelled');assert.ok(after.team_members.filter(v=>v.team_id===t.id).every(v=>v.membership_status==='cancelled'));
 const clean=await proposal(f);const forged=structuredClone(clean.plan.effects);(forged.teams as Record<string,unknown>[])[0].entry_state='cancelled';
 await assert.rejects(command(db,{...clean.input,effects:forged}),/INVALID_EFFECTS/);
 const unknown=await proposal(f,[{entry_id:after.teams.find(v=>v.entry_state==='approved')!.id,entry_name:'Missing',player_ids:[randomUUID()]}]);
 await assert.rejects(command(db,unknown.input),/ACCOUNT_REQUIRED/);
 assert.deepEqual(await getSnapshot(rpc,host,f.event),after);
});
test('SQL rejects revisions after any historical play and limits descriptive changes',async()=>{
 const f=await fixture();const p=await proposal(f);await f.run('startTournament');let s=await getSnapshot(rpc,host,f.event);await f.run('startMatch',{match_id:s.matches[0].id});s=await getSnapshot(rpc,host,f.event);
 await assert.rejects(command(db,{...p.input,revision:Number(s.event!.revision)}),/STRUCTURE_LOCKED/);
 await assert.rejects(command(db,{...p.input,actor:stranger,revision:Number(s.event!.revision)}),/FORBIDDEN/);
 await f.run('updateEventDetails',{name:'New label',venue_name:'New venue',reason:'Spelling'});s=await getSnapshot(rpc,host,f.event);assert.equal(s.event!.name,'New label');assert.equal(s.event!.definition_id,p.snapshot.event!.definition_id);
 await assert.rejects(command(db,{event:f.event,command:'updateEventDetails',revision:Number(s.event!.revision),request:{name:'X',venue_name:'Y',reason:'Z'},effects:{event:{name:'X',court_name:'Y',court_count:99}}}),/INVALID_EFFECTS/);
});

test('SQL rejects missing membership status and forged player projection status without writes',async()=>{
 const f=await fixture();const p=await proposal(f);const before=await getSnapshot(rpc,host,f.event);
 for(const status of [undefined,null]) {
  const effects=structuredClone(p.plan.effects);
  (effects.team_members as Record<string,unknown>[]).push({id:randomUUID(),team_id:before.teams[0].id,user_id:owner,...(status===null?{membership_status:null}:{})});
  await assert.rejects(command(db,{...p.input,effects}),/INVALID_EFFECTS/);
 }
 for(const field of ['id','user_id','status']) for(const value of [undefined,null]) {
  const effects=structuredClone(p.plan.effects);const projection=(effects.tournament_players as Record<string,unknown>[])[0];
  if(value===undefined) delete projection[field];else projection[field]=value;
  await assert.rejects(command(db,{...p.input,effects}),/INVALID_EFFECTS/);
 }
 const effects=structuredClone(p.plan.effects);(effects.tournament_players as Record<string,unknown>[])[0].status='rejected';
 await assert.rejects(command(db,{...p.input,effects}),/INVALID_EFFECTS/);
 assert.deepEqual(await getSnapshot(rpc,host,f.event),before);
});

test('SQL accepts a removal with only its entry ID and remove flag',async()=>{
 const f=await fixture();const s=await getSnapshot(rpc,host,f.event);const removed=s.teams[0];
 const p=await proposal(f,[{entry_id:removed.id,remove:true}]);
 const forged=structuredClone(p.plan.effects);const removedPlayer=s.team_members.find(m=>m.team_id===removed.id)!.user_id;
 (forged.tournament_players as Record<string,unknown>[]).find(v=>v.user_id===removedPlayer)!.status='approved';
 await assert.rejects(command(db,{...p.input,effects:forged}),/INVALID_EFFECTS/);
 forged.tournament_players=forged.tournament_players!.filter(v=>v.user_id!==removedPlayer);
 await assert.rejects(command(db,{...p.input,effects:forged}),/INVALID_EFFECTS/);
 await command(db,p.input);
 const result=await getSnapshot(rpc,host,f.event);assert.equal(result.teams.find(t=>t.id===removed.id)!.entry_state,'cancelled');
});
