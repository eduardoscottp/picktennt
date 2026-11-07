import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { storageDatabase, role, owner } from './helpers/storage-db';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { previewPlayerWithdrawal } from '../../lib/tournament-builder/player-withdrawal';
import { previewPlayerReplacement } from '../../lib/tournament-builder/player-replacement';

test('withdrawal then unplayed walkover preserves partial lineup when a vacancy is filled and teammate replaced', async()=>{
 const db=await storageDatabase();
 try {
  const rpc:RpcClient={async rpc(name,args){try {const keys=Object.keys(args);const result=await role(db,'service_role',owner,()=>db.query<{value:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v)));return {data:result.rows[0].value,error:null};}catch(error){return {data:null,error:{message:String(error)}};}}};
  const actor={id:owner,clientId:'web'}, ids=Array.from({length:8},()=>randomUUID());
  for(const user of ids) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,`${user}@example.invalid`]);
  const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
  definition.event.starts_at='2030-11-07T09:00:00-05:00'; definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
  definition.registration={...definition.registration,entry_type:'fixed_doubles',partner_consent:false,mode:'approval',min_entries:2,max_entries:3,closes_at:'2030-11-06T18:00:00-05:00'};
  definition.nodes=definition.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
  const created=await executeCommand(rpc,actor,'createDraft',null,{operation_id:randomUUID(),data:{definition}}), event=created.tournament_id;
  let snapshot=await getSnapshot(rpc,actor,event);
  const run=async(command:string,data:Record<string,unknown>)=>{const result=await executeCommand(rpc,actor,command,event,{operation_id:randomUUID(),expected_revision:Number(snapshot.event!.revision),data});snapshot=await getSnapshot(rpc,actor,event);return result;};
  const publication=await previewTournament(rpc,actor,event); await run('publishTournament',{reviewed_definition_hash:publication.definitionHash,acknowledged_warning_codes:publication.warningCodes??[]});
  for(let i=0;i<6;i++) await run('adminFillPosition',{user_id:ids[i],slot_index:Math.floor(i/2)+1,position:i%2+1,reason:'Initial roster'});
  const team=snapshot.team_members.find(member=>member.user_id===ids[0]&&member.membership_status==='active')!.team_id;
  await run('closeRegistration',{}); await run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision}); await run('startTournament',{});
  const withdrawal={team_id:team,user_id:ids[1],reason:'Player withdrew'}, withdrawalReview=previewPlayerWithdrawal(snapshot,actor,withdrawal);
  await run('withdrawPlayer',{...withdrawal,preview_hash:withdrawalReview.preview_hash});
  const match=snapshot.matches.find(row=>row.status==='scheduled'&&(row.team_a_id===team||row.team_b_id===team))!, side=match.team_a_id===team?'a':'b';
  await run('attestScore',{match_id:match.id,outcome_kind:'walkover',winner_entry_id:match.team_a_id===team?match.team_b_id:match.team_a_id,reason:'Absent player'});
  const history=structuredClone(snapshot.matches.find(row=>row.id===match.id)!);
  assert.deepEqual([history[`player_${side}1_id`],history[`player_${side}2_id`]].filter(Boolean),[ids[0]]);
  await run('adminFillPosition',{user_id:ids[6],slot_index:1,position:2,reason:'Fill vacancy'});
  const replacement={team_id:team,old_user_id:ids[0],new_user_id:ids[7],reason:'Replace teammate'}, review=previewPlayerReplacement(snapshot,actor,replacement);
  assert.deepEqual(review.unknown_history_match_ids,[]);
  await run('replacePlayer',{...replacement,preview_hash:review.preview_hash});
  assert.deepEqual(snapshot.matches.find(row=>row.id===match.id),history);
 } finally { await db.close(); }
});
