import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { definitionHash } from '../../lib/tournament-builder/requests';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import { previewWithdrawal } from '../../lib/tournament-builder/corrections';

for (const [qualifiers,withdrawals] of [[4,1],[4,2],[4,3],[2,3]] as const) test(`reviewed automatic outcomes remain audited in SQL: top=${qualifiers}, withdrawals=${withdrawals}`, async () => {
 const db=await storageDatabase();
 try {
  const event=randomUUID(), actor:CommandActor={id:owner,clientId:'web',role:'owner'};
  const context={now:'2026-10-29T00:00:00Z',id:randomUUID,draw:(ids:readonly string[])=>[...ids]};
  const d=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
  d.registration.mode='open';d.registration.entry_type='singles';d.registration.partner_consent=false;d.registration.min_entries=4;d.registration.max_entries=4;
  d.nodes.find((n:{module:string})=>n.module==='elimination@1').config.bronze=qualifiers===4;
  d.nodes.find((n:{module:string})=>n.module==='qualify@1').config.count=qualifiers;
  let current:CommandSnapshot={event:null,definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[]};
  async function read(){return role(db,'service_role',owner,async()=>(await db.query<{value:CommandSnapshot}>('SELECT tb_get_snapshot($1,$2,$3,NULL) value',[owner,'web',event])).rows[0].value);}
  async function run(name:string,data:Record<string,unknown>,user:CommandActor=actor){const plan=planCommand(current,user,name,data,context);await command(db,{event,actor:user.id,command:name,revision:current.event?Number(current.event.revision):null,request:data,effects:plan.effects,result:plan.result});current=await read();}
  await run('createDraft',{definition:d});await run('publishTournament',{reviewed_definition_hash:definitionHash(d),acknowledged_warning_codes:[]});
  for(let i=0;i<4;i++){const user=randomUUID();await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,`${user}@example.invalid`]);await run('requestEntry',{definition_id:current.event!.definition_id,consent:true,entry_name:String.fromCharCode(65+i)},{id:user,clientId:'web',role:'player'});}
  await run('closeRegistration',{});await run('lockRoster',{reviewed_roster_revision:current.event!.roster_revision});await run('startTournament',{});
  for(const match of [...current.matches]){const a=current.teams.find(t=>t.id===match.team_a_id)!,b=current.teams.find(t=>t.id===match.team_b_id)!,wins=String(a.name)<String(b.name);await run('attestScore',{match_id:match.id,outcome_kind:'played',score_a:wins?11:5,score_b:wins?5:11,reason:'Observed'});}
  const dropped=current.teams.find(team=>team.name==='D')!;
  for (const name of ['D','C','B'].slice(0,withdrawals)) {
   const team=current.teams.find(candidate=>candidate.name===name)!;
   const proposal={entry_id:team.id,reason:'Team withdrew'};const withdrawal=previewWithdrawal(current,actor,proposal,context.now);
   await run('withdrawEntry',{...proposal,preview_hash:withdrawal.preview_hash});
  }
  assert.equal(current.matches.length,6);
  const review=previewNextStage(current,actor);if(review.state!=='ready')throw new Error(`Expected ready review: ${review.state}`);
  const automatic=review.fixtures.flatMap(f=>'automatic_outcome' in f && f.automatic_outcome ? [{outcome:f.automatic_outcome,winner:f.automatic_winner_entry_id}] : []);
  assert.equal(automatic.length,qualifiers===2?1:withdrawals===1?1:withdrawals===2?3:4);assert.ok(automatic.some(item=>item.outcome==='walkover'));
  const data={preview_hash:review.preview_hash},plan=planCommand(current,actor,'generateNextStage',data,context);
  const forged=structuredClone(plan.effects);forged.matches!.find(match=>match.status==='walkover')!.winner_team_id=dropped.id;
  const input={event,command:'generateNextStage',revision:Number(current.event!.revision),request:data,effects:plan.effects,result:plan.result};
  await assert.rejects(command(db,{...input,effects:forged}),/INVALID_EFFECTS/);
  const op=randomUUID(),receipt=await command(db,{...input,operation:op});assert.deepEqual(await command(db,{...input,operation:op}),receipt);
  current=await read();const walkover=current.matches.find(match=>match.outcome_kind==='walkover')!;
  assert.ok(automatic.some(item=>item.winner===walkover.winner_team_id));assert.equal(walkover.validated_by,owner);assert.equal(walkover.score_a,null);assert.equal(walkover.score_b,null);
  if(qualifiers===4){const final=current.matches.find(match=>match.logical_key==='playoff:r2:m1')!;assert.ok([final.team_a_id,final.team_b_id].includes(walkover.winner_team_id));}
  if(withdrawals===3){const placement=current.stages.find(stage=>stage.module_id==='placements')!.output as {groups:{rank:number;entryIds:string[]}[]};assert.equal(current.event!.modular_state,'completed');assert.deepEqual(placement.groups.map(group=>group.rank),[1]);assert.ok(!placement.groups.flatMap(group=>group.entryIds).includes(dropped.id));}
 } finally {await db.close();}
});
