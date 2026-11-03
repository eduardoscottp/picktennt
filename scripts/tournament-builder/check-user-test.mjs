import { createClient } from '@supabase/supabase-js';
import { managementEnvironment } from './hosted-acceptance.mjs';
import { getSnapshot, executeCommand } from '../../lib/tournament-builder/repository.ts';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const env = managementEnvironment('qmiljmxnnryhuaudpuff');
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const actor={id:'97d6ea0f-9588-4369-906a-cbfde702ed96',clientId:'web'}, event='549b556b-3533-5b64-a89a-b4552294fa2b';
let s = await getSnapshot(db, actor, event);
if(process.argv.includes('--finish-round-robin')) {
 const ids=['81842945-f756-41c7-9678-deb0623ff353','9dbce252-1aea-40ae-b1aa-fab118f6f243'];
 if(s.event.revision!==29||s.event.modular_state!=='active'||ids.some(id=>!s.matches.some(m=>m.id===id&&m.status==='scheduled'))) throw new Error('PREFLIGHT_CHANGED');
 const report={origin:'User requested synthetic scores for the remaining two round-robin games and advancement. Using 11-5 to side A in each.',operations:[],verified:false};
 const save=()=>writeFileSync(new URL('../../../verification-local/2026-10-28-finish-round-robin.json',import.meta.url),JSON.stringify(report,null,2));
 async function command(name,data){
  const input={operation_id:randomUUID(),expected_revision:s.event.revision,data};
  report.operations.push({command:name,input});save();
  report.operations.at(-1).receipt=await executeCommand(db,actor,name,event,input);
  s=await getSnapshot(db,actor,event);save();
 }
 for(const id of ids){
  await command('startMatch',{match_id:id});
  await command('attestScore',{match_id:id,score_a:11,score_b:5,outcome_kind:'played',reason:'Synthetic 11-5 test score entered and validated at the administrator request to advance the MVP test.'});
 }
 const tied=s.stages.find(t=>Array.isArray(t.output?.ties)&&t.output.ties.length);
 if(tied) for(const group of tied.output.ties) await command('resolveTie',{stage_id:tied.id,entry_ids:group,input_revision:tied.output.inputRevision});
 if(ids.some(id=>!s.matches.some(m=>m.id===id&&m.status==='validated'))) throw new Error('VERIFICATION_FAILED');
 report.verified=true;report.revision=s.event.revision;save();
}
if(process.argv.includes('--attest-round-two')) {
 const results=[{id:'23df9675-a1f7-4024-af25-94c4b6930bca',a:11,b:4},{id:'5af291d3-e00a-4101-acb7-2e172f2d2a84',a:11,b:5}];
 if(s.event.modular_state!=='active' || results.some(r=>!s.matches.some(m=>m.id===r.id&&m.status==='score_entered'&&m.score_a===r.a&&m.score_b===r.b))) throw new Error('SUBMITTED_RESULTS_CHANGED');
 const report={origin:'User explicitly requested administrator validation of existing submitted results.',operations:[],verified:false};
 const save=()=>writeFileSync(new URL('../../../verification-local/2026-10-28-attest-round-two.json',import.meta.url),JSON.stringify(report,null,2));
 for(const r of results) {
  const input={operation_id:randomUUID(),expected_revision:s.event.revision,data:{match_id:r.id,score_a:r.a,score_b:r.b,outcome_kind:'played',reason:'Administrator explicitly requested validation of this submitted test result. Existing score preserved.'}};
  report.operations.push({command:'attestScore',input}); save();
  report.operations.at(-1).receipt=await executeCommand(db,actor,'attestScore',event,input);
  s=await getSnapshot(db,actor,event); save();
 }
 if(results.some(r=>!s.matches.some(m=>m.id===r.id&&m.status==='validated'&&m.score_a===r.a&&m.score_b===r.b))) throw new Error('VERIFICATION_FAILED');
 report.verified=true; report.revision=s.event.revision; save();
}
if(process.argv.includes('--attest-existing')) {
 const ids=['40fc9d01-3436-4e03-a8f6-765856235218','c256b14a-ac6b-4966-882c-745d2a9aa664'];
 if(s.event.modular_state!=='active' || ids.some(id=>!s.matches.some(m=>m.id===id&&m.status==='score_entered'&&m.score_a===11&&m.score_b===5))) throw new Error('SUBMITTED_RESULTS_CHANGED');
 const report={origin:'Administrator explicitly requested validation of the two existing test scores. Scores preserved.',operations:[]};
 const save=()=>writeFileSync(new URL('../../../verification-local/2026-10-28-attest-user-scores.json',import.meta.url),JSON.stringify(report,null,2));
 for(const id of ids) {
  const input={operation_id:randomUUID(),expected_revision:s.event.revision,data:{match_id:id,score_a:11,score_b:5,outcome_kind:'played',reason:'Administrator requested validation of the existing submitted test score to continue MVP testing.'}};
  report.operations.push({command:'attestScore',input}); save();
  report.operations.at(-1).receipt=await executeCommand(db,actor,'attestScore',event,input);
  s=await getSnapshot(db,actor,event); save();
 }
 if(ids.some(id=>!s.matches.some(m=>m.id===id&&m.status==='validated'&&m.score_a===11&&m.score_b===5))) throw new Error('VERIFICATION_FAILED');
 report.verified=true; report.revision=s.event.revision; save();
}
if(process.argv.includes('--details')) console.log(JSON.stringify({matches:s.matches,definition:s.definitions.find(d=>d.id===s.event.definition_id)?.definition},null,2));
if(process.argv.includes('--start')) {
 if(s.event.revision!==13 || s.event.roster_revision!==8 || s.event.modular_state!=='registration_open' || s.teams.length!==4 || s.teams.some(t=>t.entry_state!=='approved') || s.matches.length) throw new Error('PREFLIGHT_CHANGED');
 const report={origin:'User requested continue after approving the fourth entry. Administrative commands; no scores entered.',operations:[]};
 for(const command of ['closeRegistration','lockRoster','startTournament']) {
  const input={operation_id:randomUUID(),expected_revision:s.event.revision,data:command==='lockRoster'?{reviewed_roster_revision:s.event.roster_revision}:{}};
  report.operations.push({command,input});
  writeFileSync(new URL('../../../verification-local/2026-10-28-start-user-test.json',import.meta.url),JSON.stringify(report,null,2));
  report.operations.at(-1).receipt=await executeCommand(db,actor,command,event,input);
  s=await getSnapshot(db,actor,event);
  report.state=s.event.modular_state; report.revision=s.event.revision;
  writeFileSync(new URL('../../../verification-local/2026-10-28-start-user-test.json',import.meta.url),JSON.stringify(report,null,2));
 }
}
console.log(JSON.stringify({state:s.event.modular_state,revision:s.event.revision,roster_revision:s.event.roster_revision,entries:s.teams.map(t=>({name:t.name,state:t.entry_state})),matches:s.matches.map(m=>({id:m.id,status:m.status,court:m.court_number,a:s.teams.find(t=>t.id===m.team_a_id)?.name,b:s.teams.find(t=>t.id===m.team_b_id)?.name})),stages:s.stages.map(t=>({state:t.state,output:t.output}))},null,2));
