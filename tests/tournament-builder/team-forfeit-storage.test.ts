import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewTeamForfeit, TEAM_FORFEIT_POLICY } from '../../lib/tournament-builder/team-forfeit';
import { definitionHash, requestHash } from '../../lib/tournament-builder/requests';
import { command as applySql, owner, player, stranger, role, storageDatabase } from './helpers/storage-db';

test('SQL full-team forfeit is atomic, audited, retry-safe and rejects forged scores or partial effects', async()=>{
 const db=await storageDatabase(),host:CommandActor={id:owner,clientId:'web',role:'owner'};
 try {
  await db.exec(readFileSync('supabase/migrations/202611090004_modular_team_forfeit.sql','utf8'));
  async function setup(completed=false) {
   const event=randomUUID();
   let snapshot:CommandSnapshot={event:null,definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[]};
   async function refresh(){snapshot=(await role(db,'service_role',owner,()=>db.query<{value:CommandSnapshot}>("SELECT public.tb_get_snapshot($1,'web',$2,NULL) value",[owner,event]))).rows[0].value;}
   async function run(command:string,data:Record<string,unknown>={},actor=host){const revision=snapshot.event?Number(snapshot.event.revision):null;const plan=planCommand(snapshot,actor,command,data,{now:new Date().toISOString(),id:randomUUID,draw:ids=>[...ids]});await applySql(db,{actor:actor.id,event,command,revision,hash:requestHash(command,event,revision??undefined,data),request:data,effects:plan.effects,result:plan.result});await refresh();}
   const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
   definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T16:00:00-05:00';
   definition.registration={...definition.registration,min_entries:2,max_entries:3,entry_type:'singles',partner_consent:false,mode:'open',closes_at:'2030-11-06T18:00:00-05:00'};
   definition.policies.match.target=21;
   definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
   await run('createDraft',{definition});await run('publishTournament',{reviewed_definition_hash:definitionHash(definition),acknowledged_warning_codes:[]});
   for(const [index,user] of [owner,player,stranger].entries())await run('requestEntry',{consent:true,definition_id:snapshot.event!.definition_id,entry_name:String.fromCharCode(65+index)},{id:user,clientId:'web'});
   await run('closeRegistration');await run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});await run('startTournament');
   const target=snapshot.teams.find(team=>team.name==='A')!;
   const games=completed?snapshot.matches:snapshot.matches.filter(match=>[match.team_a_id,match.team_b_id].includes(target.id)).slice(0,1);
   for(const match of games){const a=snapshot.teams.find(team=>team.id===match.team_a_id)!,b=snapshot.teams.find(team=>team.id===match.team_b_id)!;await run('attestScore',{match_id:match.id,outcome_kind:'played',score_a:String(a.name)<String(b.name)?21:4,score_b:String(a.name)<String(b.name)?4:21,reason:'Played result'});}
   return {event,get snapshot(){return snapshot},target,run,refresh};
  }
  for(const completed of [false,true]) {
   const f=await setup(completed),before=structuredClone(f.snapshot);
   assert.equal(before.event!.modular_state,completed?'completed':'active');
   const proposal={entry_id:f.target.id,reason:'Confirmed full team withdrawal',policy:TEAM_FORFEIT_POLICY};
   const preview=previewTeamForfeit(before,host,proposal);
   const request={...proposal,preview_hash:preview.preview_hash,confirmed_forfeit:true};
   const plan=planCommand(before,host,'withdrawEntry',request,{now:new Date().toISOString(),id:randomUUID});
   const revision=Number(before.event!.revision);
   const forged=structuredClone(plan.effects);forged.matches!.find(match=>match.outcome_kind==='administrative_score')!.score_a=99;
   await assert.rejects(applySql(db,{event:f.event,command:'withdrawEntry',revision,request,effects:forged}),/INVALID_EFFECTS/);
   const partial=structuredClone(plan.effects);partial.matches=partial.matches!.filter((match,index)=>index!==partial.matches!.findIndex(row=>row.outcome_kind==='administrative_score'));
   await assert.rejects(applySql(db,{event:f.event,command:'withdrawEntry',revision,request,effects:partial}),/INVALID_EFFECTS/);
   await assert.rejects(applySql(db,{event:f.event,command:'withdrawEntry',revision,request:{...request,confirmed_forfeit:false},effects:plan.effects}),/INVALID_REQUEST/);
   await f.refresh();assert.deepEqual(f.snapshot,before);
   const operation=randomUUID(),input={event:f.event,operation,command:'withdrawEntry',revision,request,hash:requestHash('withdrawEntry',f.event,revision,request),effects:plan.effects,result:plan.result};
   const first=await applySql(db,input),retry=await applySql(db,input);assert.deepEqual(retry,first);
   await f.refresh();
   for(const match of f.snapshot.matches.filter(match=>[match.team_a_id,match.team_b_id].includes(f.target.id))){assert.equal(match.outcome_kind,'administrative_score');assert.equal(match.score_a,match.team_a_id===f.target.id?0:11);assert.equal(match.score_b,match.team_b_id===f.target.id?0:11);assert.equal(match.submit_to_dupr,false);assert.equal(match.excluded_at,null);}
   const standing=f.snapshot.standings.find(row=>row.team_id===f.target.id)!;
   assert.equal(standing.wins,0);assert.equal(standing.losses,2);assert.equal(standing.points_against,22);assert.equal(standing.rank,null);assert.equal(standing.eligible,false);
   for(const match of before.matches.filter(match=>![match.team_a_id,match.team_b_id].includes(f.target.id)))assert.deepEqual(f.snapshot.matches.find(row=>row.id===match.id),match);
   assert.equal(Number(f.snapshot.event!.revision),revision+1);
   const audit=(await db.query<{before_facts:CommandSnapshot;after_facts:CommandSnapshot;reason:string}>('SELECT before_facts,after_facts,reason FROM tournament_operations WHERE operation_id=$1',[operation])).rows[0];
   assert.equal(audit.reason,proposal.reason);assert.ok(audit.before_facts.matches.some(match=>match.outcome_kind==='played'&&[match.team_a_id,match.team_b_id].includes(f.target.id)));assert.ok(audit.after_facts.matches.some(match=>match.outcome_kind==='administrative_score'));
   await assert.rejects(applySql(db,{...input,operation:randomUUID()}),/STALE_REVISION/);
  }
 } finally {await db.close();}
});
