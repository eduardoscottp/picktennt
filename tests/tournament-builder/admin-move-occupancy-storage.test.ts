import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { planCommand } from '../../lib/tournament-builder/commands';

test('SQL protects occupied explicit and legacy null positions while allowing valid moves', async()=>{
 const db=await storageDatabase();
 try {
  const rpc:RpcClient={async rpc(name,args){try{const keys=Object.keys(args);const result=await role(db,'service_role',owner,()=>db.query<{value:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v)));return {data:result.rows[0].value,error:null};}catch(error){return {data:null,error:{message:String(error)}};}}};
  const host={id:owner,clientId:'web'}, d=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
  d.event.starts_at='2030-11-07T09:00:00-05:00';d.event.expected_end_at='2030-11-07T12:30:00-05:00';
  d.registration={...d.registration,entry_type:'fixed_doubles',partner_consent:false,mode:'approval',min_entries:2,max_entries:2,closes_at:'2030-11-06T18:00:00-05:00'};
  d.nodes=d.nodes.slice(0,4).concat({id:'result',module:'placements@1',from:'rank'});
  const created=await executeCommand(rpc,host,'createDraft',null,{operation_id:randomUUID(),data:{definition:d}}), event=created.tournament_id;
  let s=await getSnapshot(rpc,host,event);
  const run=async(commandName:string,data:Record<string,unknown>,who=host)=>{await executeCommand(rpc,who,commandName,event,{operation_id:randomUUID(),expected_revision:Number(s.event!.revision),data});s=await getSnapshot(rpc,host,event);};
  const preview=await previewTournament(rpc,host,event);await run('publishTournament',{reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]});
  for(const id of [player,stranger]) await run('joinTournament',{definition_id:s.event!.definition_id,consent:true},{id,clientId:'web'});
  await run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
  await run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:2});
  await run('placeRegisteredPlayer',{user_id:player,slot_index:1,position:1});
  await run('placeRegisteredPlayer',{user_id:stranger,slot_index:2,position:1});
  const playerMember=s.team_members.find(row=>row.user_id===player&&row.membership_status==='active')!;
  const proposal={user_id:stranger,slot_index:1,position:2};
  const effects=planCommand(s,host,'placeRegisteredPlayer',proposal,{now:new Date().toISOString(),id:randomUUID}).effects;
  effects.team_members!.find(row=>row.membership_status==='active')!.player_slot=1;
  const request={...proposal,position:1};
  await assert.rejects(command(db,{event,command:'placeRegisteredPlayer',revision:Number(s.event!.revision),request,effects}),/SLOT_FULL/);
  await db.exec('ALTER TABLE public.team_members DISABLE TRIGGER tb_guard');
  try { await db.query('UPDATE public.team_members SET player_slot=NULL WHERE id=$1',[playerMember.id]); }
  finally { await db.exec('ALTER TABLE public.team_members ENABLE TRIGGER tb_guard'); }
  await assert.rejects(command(db,{event,command:'placeRegisteredPlayer',revision:Number(s.event!.revision),request,effects}),/SLOT_FULL/);
  s=await getSnapshot(rpc,host,event); await run('placeRegisteredPlayer',proposal);
  const moved=s.team_members.find(row=>row.user_id===stranger&&row.membership_status==='active')!;
  await assert.rejects(command(db,{event,command:'placeRegisteredPlayer',revision:Number(s.event!.revision),request,effects:{team_members:[{id:moved.id,user_id:stranger,player_slot:1}]}}),/SLOT_FULL/);
  assert.equal((await getSnapshot(rpc,host,event)).team_members.find(row=>row.id===moved.id)?.player_slot,2);
 } finally {await db.close();}
});
