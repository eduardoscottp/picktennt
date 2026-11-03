import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { managementEnvironment } from './hosted-acceptance.mjs';
import { executeCommand, getSnapshot } from '../../lib/tournament-builder/repository.ts';
const EVENT='549b556b-3533-5b64-a89a-b4552294fa2b', REF='qmiljmxnnryhuaudpuff';
const PURPOSE='tournament-builder-hosted-acceptance', RUN='4bf6bf41-ebf0-4019-9bf7-0b29a33edc4d';
const base=new URL('../../../verification-local/2026-10-28-add-two-test-players-',import.meta.url);
const file=s=>new URL(base.href+s+'.json');
const save=(suffix,data)=>fs.writeFileSync(file(suffix),JSON.stringify(data,null,2)+'\n');
const check=(condition,code)=>{ if(!condition) throw new Error(code); };
const env=managementEnvironment(REF);
const service=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const evidence=JSON.parse(fs.readFileSync(new URL('../../docs/evidence/hosted-acceptance-2026-10-28.json',import.meta.url),'utf8'));
const accounts=evidence.synthetic_accounts.slice(0,2).map((account,index)=>({...account,entry_name:'Test Player '+(index+3)}));
check(accounts.length===2&&evidence.synthetic_run===RUN,'ACCOUNT_EVIDENCE_MISMATCH');
const eventQuery=await service.from('tournaments').select('id,created_by,revision,modular_state,definition_id,roster_revision').eq('id',EVENT).single();
check(!eventQuery.error&&eventQuery.data?.id===EVENT,'EXACT_EVENT_NOT_FOUND');
const owner={id:eventQuery.data.created_by,clientId:'web'};
const before=await getSnapshot(service,owner,EVENT);
const def=before.definitions.find(d=>d.id===before.event.definition_id);
check(before.event.modular_state==='registration_open'&&def?.status==='published','REGISTRATION_STATE_CHANGED');
check(def.definition.registration.entry_type==='singles'&&def.definition.registration.max_entries===4,'CAPACITY_OR_TYPE_CHANGED');
check(Date.parse(def.definition.registration.closes_at)>Date.now(),'REGISTRATION_DEADLINE_PASSED');
check(before.teams.length===2&&before.team_members.length===2&&before.matches.length===0,'EXPECTED_TWO_EXISTING_ENTRIES');
check(before.teams.every(t=>['pending','approved'].includes(t.entry_state)),'EXISTING_ENTRY_STATE_CHANGED');
check(!accounts.some(a=>before.team_members.some(m=>m.user_id===a.id)),'SYNTHETIC_ALREADY_IN_EVENT');
check(!accounts.some(a=>before.teams.some(t=>t.name===a.entry_name)),'TEST_ENTRY_NAME_ALREADY_USED');
const accountChecks=[];
for(const account of accounts){
 const result=await service.auth.admin.getUserById(account.id), user=result.data?.user;
 check(!result.error&&user?.user_metadata?.tb_synthetic_run===RUN&&user.user_metadata.tb_synthetic_purpose===PURPOSE,'SYNTHETIC_MARKER_MISMATCH');
 check(typeof user.email==='string'&&user.email.endsWith('@example.invalid')&&user.email_confirmed_at,'SYNTHETIC_ACCOUNT_NOT_CONFIRMED');
 check(Date.parse(user.banned_until)>Date.now(),'SYNTHETIC_EXPECTED_BANNED');
 accountChecks.push({id:account.id,label:account.label,display_name:`${user.user_metadata.given_name} ${user.user_metadata.family_name}`,marker_verified:true,confirmed:true,was_banned:true});
}
const preflight={recorded_at:new Date().toISOString(),project_ref:REF,tournament_id:EVENT,owner_id:owner.id,revision:before.event.revision,roster_revision:before.event.roster_revision,lifecycle:before.event.modular_state,mode:def.definition.registration.mode,capacity:def.definition.registration.max_entries,definition_id:def.id,existing_entries:before.teams.map(t=>({id:t.id,name:t.name,state:t.entry_state})),synthetic_accounts:accountChecks,before_snapshot:before};
if(!process.argv.includes('--apply')){save('preflight',preflight);console.log(JSON.stringify({...preflight,before_snapshot:undefined}));process.exit(0);}
const planned=JSON.parse(fs.readFileSync(file('preflight'),'utf8'));
assert.deepEqual(before,planned.before_snapshot);
const report={recorded_at:new Date().toISOString(),project_ref:REF,tournament_id:EVENT,origin:'User-requested synthetic test enrollment. Each marker-verified synthetic identity signs in natively and explicitly consents to the exact published definition. Owner approvals are administrative user-requested fixture actions, not browser-owner clicks or real-person consent.',prior_revision:before.event.revision,prior_roster_revision:before.event.roster_revision,operations:[],synthetic_accounts:accountChecks,cleanup:[],passed:false};
const clients=[];let expected=Number(before.event.revision);
async function current(){return await getSnapshot(service,owner,EVENT);}
async function fenced(){const s=await current();check(s.event.revision===expected&&s.event.modular_state==='registration_open'&&s.event.definition_id===def.id,'EVENT_CHANGED_ABORT');assert.deepEqual(s.definitions,before.definitions);check(s.matches.length===0,'MATCHES_CHANGED_ABORT');for(const kind of ['teams','team_members','tournament_players'])for(const row of before[kind])assert.deepEqual(s[kind].find(r=>r.id===row.id),row);check(s.teams.filter(t=>t.entry_state==='approved').length<=4,'CAPACITY_CHANGED_ABORT');return s;}
async function webPost(client,envelope){
 const url=`https://app.picktennt.com/api/tournament-builder/${EVENT}/commands?command=requestEntry`;
 const response=await fetch(url,{method:'POST',redirect:'manual',headers:{origin:'https://app.picktennt.com','content-type':'application/json',cookie:[...client.jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:JSON.stringify(envelope),signal:AbortSignal.timeout(30000)});
 const body=await response.json();if(!response.ok)throw new Error(typeof body.code==='string'?body.code:'REGISTRATION_HTTP_FAILED');return body;
}
try{
 for(const account of accounts){
  await fenced();
  const found=await service.auth.admin.getUserById(account.id);check(found.data?.user?.user_metadata?.tb_synthetic_run===RUN&&found.data.user.user_metadata.tb_synthetic_purpose===PURPOSE,'SYNTHETIC_MARKER_MISMATCH');
  const password=randomBytes(32).toString('base64url')+'Aa1!';
  const reset=await service.auth.admin.updateUserById(account.id,{password,ban_duration:'none',email_confirm:true});check(!reset.error,'SYNTHETIC_UNBAN_FAILED');
  const client={id:account.id,label:account.label,jar:new Map(),sdk:null};clients.push(client);
  client.sdk=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{autoRefreshToken:false,detectSessionInUrl:false},cookies:{getAll:()=>[...client.jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(v=>v.value?client.jar.set(v.name,v.value):client.jar.delete(v.name))}});
  const signin=await client.sdk.auth.signInWithPassword({email:found.data.user.email,password});check(!signin.error&&signin.data.user.id===account.id,'SYNTHETIC_NATIVE_SIGNIN_FAILED');
  await fenced();
  const envelope={operation_id:randomUUID(),expected_revision:expected,data:{definition_id:def.id,consent:true,entry_name:account.entry_name}};
  report.operations.push({command:'requestEntry',actor_id:account.id,envelope,status:'submitted'});save('result',report);
  let receipt;
  try{receipt=await webPost(client,envelope);}catch(error){
   // Resolve uncertainty using the SAME immutable request. SQL receipt preflight precedes lifecycle/revision checks.
   if(error instanceof Error&&/^[A-Z_]+$/.test(error.message))throw error;
   receipt=await executeCommand(service,{id:account.id,clientId:'web'},'requestEntry',EVENT,envelope);
  }
  report.operations.at(-1).receipt=receipt;report.operations.at(-1).status='committed';expected=receipt.revision;save('result',report);
  check(receipt.data?.entry_id,'REQUEST_RECEIPT_ENTRY_MISSING');await fenced();
  if(def.definition.registration.mode==='approval'){
   const approval={operation_id:randomUUID(),expected_revision:expected,data:{entry_id:receipt.data.entry_id}};
   report.operations.push({command:'approveEntry',actor_id:owner.id,envelope:approval,status:'submitted'});save('result',report);
   const approved=await executeCommand(service,owner,'approveEntry',EVENT,approval);
   report.operations.at(-1).receipt=approved;report.operations.at(-1).status='committed';expected=approved.revision;save('result',report);
   check(approved.data.entry_state==='approved','SYNTHETIC_APPROVAL_FAILED');
  }else check(receipt.data.entry_state==='approved','SYNTHETIC_ADMISSION_FAILED');
 }
 const after=await fenced();check(after.teams.length===4&&after.team_members.length===4&&after.tournament_players.length===4,'FINAL_ROSTER_NOT_FOUR');
 for(const account of accounts){const member=after.team_members.find(m=>m.user_id===account.id);check(member?.membership_status==='active'&&member.consented_definition_id===def.id&&member.consented_at,'SYNTHETIC_CONSENT_NOT_ACTIVE');check(after.teams.find(t=>t.id===member.team_id)?.entry_state==='approved','SYNTHETIC_NOT_APPROVED');}
 report.passed=true;report.revision=after.event.revision;report.roster_revision=after.event.roster_revision;report.lifecycle=after.event.modular_state;report.entries=after.teams.map(t=>({id:t.id,name:t.name,state:t.entry_state,display_names:after.team_members.filter(m=>m.team_id===t.id).map(m=>m.display_name)}));report.final_counts={entries:after.teams.length,approved_entries:after.teams.filter(t=>t.entry_state==='approved').length,memberships:after.team_members.length,players:after.tournament_players.length,matches:after.matches.length};report.existing_entries_unchanged=true;report.definition_unchanged=true;report.published_or_closed_or_locked_or_started_by_this_run=false;
}catch(error){report.error=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CHECK_FAILED';throw new Error(report.error);}
finally{
 for(const client of clients){
  const cleanup={id:client.id,signed_out:false,rebanned:false};
  try{if(client.sdk){const signout=await client.sdk.auth.signOut();cleanup.signed_out=!signout.error;}}catch{}
  try{const found=await service.auth.admin.getUserById(client.id);if(found.data?.user?.user_metadata?.tb_synthetic_run===RUN&&found.data.user.user_metadata.tb_synthetic_purpose===PURPOSE){const ban=await service.auth.admin.updateUserById(client.id,{ban_duration:'8760h'});cleanup.rebanned=!ban.error&&Date.parse(ban.data?.user?.banned_until)>Date.now();}}catch{}
  client.jar.clear();report.cleanup.push(cleanup);
 }
 report.credentials_persisted=false;save('result',report);
}
check(report.cleanup.length===2&&report.cleanup.every(c=>c.signed_out&&c.rebanned),'CLEANUP_FAILED');
console.log(JSON.stringify({passed:report.passed,revision:report.revision,lifecycle:report.lifecycle,counts:report.final_counts,entries:report.entries,cleanup:report.cleanup}));
