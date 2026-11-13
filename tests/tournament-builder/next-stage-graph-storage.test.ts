import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { storageDatabase, role, command, owner, stranger } from './helpers/storage-db';
import { planCommand, type CommandActor, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { definitionHash } from '../../lib/tournament-builder/requests';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';

for (const underfilled of [false,true]) test(`graph generation validates source results, ports, effects and revision in real SQL; underfilled=${underfilled}`, async () => {
  const db = await storageDatabase();
  try {
    const id = randomUUID, event = id(), actor = { id: owner, clientId: 'web', role: 'owner' as const };
    const context = { now: '2026-10-29T00:00:00Z', id, draw: (ids: readonly string[]) => [...ids] };
    const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
    d.schema_version = '2.0'; d.registration.mode = 'open'; d.registration.entry_type = 'singles'; d.registration.partner_consent = false;
    d.registration.min_entries = 4; d.registration.max_entries = underfilled ? 5 : 4; d.event.courts = 2; d.scheduling.minimum_rest_minutes = 0;
    d.nodes = [{ id:'reg',module:'registration@1' }, { id:'roster',module:'entries@1',from:'reg' },
      { id:'pool',module:'round_robin@2',inputs:(underfilled ? [1,2,3,4,5] : [1,2,3,4]).map(seed=>({kind:'seed',seed})) },
      { id:'s1',module:'match@1',inputs:[1,4].map(rank=>({kind:'rank',node_id:'pool',rank})) },
      { id:'s2',module:'match@1',inputs:[2,3].map(rank=>({kind:'rank',node_id:'pool',rank})) },
      { id:'final',module:'match@1',inputs:['s1','s2'].map(node_id=>({kind:'winner',node_id})) },
      { id:'bronze',module:'match@1',inputs:['s1','s2'].map(node_id=>({kind:'loser',node_id})) },
      { id:'places',module:'placements@2',final:'final',bronze:'bronze' }];
    let current: CommandSnapshot = { event:null,definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[] };
    async function read() { return role(db,'service_role',owner,async()=>(await db.query<{value:CommandSnapshot}>('SELECT tb_get_snapshot($1,$2,$3,NULL) value',[owner,'web',event])).rows[0].value); }
    async function run(name:string, data:Record<string,unknown>, user:CommandActor=actor) {
      const plan=planCommand(current,user,name,data,context);
      await command(db,{event,actor:user.id,command:name,revision:current.event ? Number(current.event.revision) : null,request:data,effects:plan.effects,result:plan.result});
      current=await read();
    }
    await run('createDraft',{definition:d}); await run('publishTournament',{reviewed_definition_hash:definitionHash(d),acknowledged_warning_codes:[]});
    for (let i=0;i<4;i++) {
      const user=id(); await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,`${user}@example.invalid`]);
      await run('requestEntry',{definition_id:current.event!.definition_id,consent:true,entry_name:String.fromCharCode(65+i)},{id:user,clientId:'web',role:'player'});
    }
    await run('closeRegistration',{});
    await run('lockRoster',{reviewed_roster_revision:current.event!.roster_revision,group_assignments:{pool:current.teams.map(team=>team.id)}});
    await run('startTournament',{});
    assert.equal(current.matches.length,6);
    for(const match of [...current.matches]) {
      const a=current.teams.find(team=>team.id===match.team_a_id)!, b=current.teams.find(team=>team.id===match.team_b_id)!;
      const aWins=String(a.name)<String(b.name);
      await run('attestScore',{match_id:match.id,outcome_kind:'played',score_a:aWins?11:5,score_b:aWins?5:11,reason:'Observed'});
    }
    assert.equal(current.matches.length,6);
    const review=previewNextStage(current,actor); assert.equal(review.state,'ready');
    if (review.state!=='ready') throw new Error('Expected ready preview');
    const request={preview_hash:review.preview_hash}, plan=planCommand(current,actor,'generateNextStage',request,context);
    const input={event,command:'generateNextStage',revision:Number(current.event!.revision),request,effects:plan.effects,result:plan.result};
    await assert.rejects(command(db,{...input,actor:stranger}),/FORBIDDEN/);
    await assert.rejects(command(db,{...input,revision:input.revision-1}),/STALE_REVISION/);
    for(const corruption of ['team','link','score','standing','stage','placement-state'] as const) {
      const bad=structuredClone(plan.effects), semi=bad.matches!.find(match=>match.logical_key==='s1:match')!;
      if(corruption==='team') semi.team_a_id=semi.team_b_id;
      if(corruption==='link') semi.bracket_next_winner_match_id=id();
      if(corruption==='score') semi.score_a=11;
      if(corruption==='standing') bad.standings![0].wins=99;
      if(corruption==='stage') bad.stages!.find(stage=>stage.id===semi.stage_id)!.output={state:'ready',entryIds:[]};
      if(corruption==='placement-state') bad.stages!.find(stage=>current.stages.find(saved=>saved.id===stage.id)?.module_id==='placements')!.state='completed';
      await assert.rejects(command(db,{...input,effects:bad}),/INVALID_EFFECTS/);
    }
    assert.equal((await read()).matches.length,6);
    const operation=id(), receipt=await command(db,{...input,operation});
    assert.deepEqual(await command(db,{...input,operation}),receipt);
    await assert.rejects(command(db,input),/STALE_REVISION/);
    current=await read(); assert.equal(current.matches.length,10);
    const semis=current.matches.filter(match=>['s1:match','s2:match'].includes(String(match.logical_key)));
    assert.equal(semis.length,2);
    for(const semi of semis) assert.ok(semi.bracket_next_winner_match_id && semi.bracket_next_loser_match_id);
  } finally { await db.close(); }
});
