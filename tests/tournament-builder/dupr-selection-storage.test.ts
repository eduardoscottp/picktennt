import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, previewTournament, type RpcClient } from '../../lib/tournament-builder/repository';
import { planCommand } from '../../lib/tournament-builder/commands';

test('DUPR selection requires current admin, completed played results and revision; SQL rejects forged effects', async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202610290004_tournament_dupr_selection.sql', 'utf8'));
    const rpc: RpcClient = { rpc: async (name,args) => role(db,'service_role',owner,async () => {
      const keys=Object.keys(args);
      try { const result=await db.query<{data:unknown}>(`SELECT public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) AS data`,keys.map(key=>typeof args[key]==='object'&&args[key]!==null?JSON.stringify(args[key]):args[key])); return {data:result.rows[0].data,error:null}; }
      catch (error) { return {data:null,error:{message:String(error)}}; }
    }) };
    const actor={id:owner,clientId:'web'};
    const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
    definition.event.starts_at='2030-11-07T09:00:00-05:00'; definition.event.expected_end_at='2030-11-07T12:30:00-05:00';
    definition.registration={...definition.registration,entry_type:'singles',min_entries:2,max_entries:2,partner_consent:false,closes_at:'2030-11-06T18:00:00-05:00'};
    definition.nodes=definition.nodes.slice(0,4);
    definition.nodes.push({id:'places',module:'placements@1',from:'rank'});
    const created=await executeCommand(rpc,actor,'createDraft',null,{operation_id:randomUUID(),data:{definition}});
    const id=created.tournament_id; let revision=created.revision;
    const run=async(name:string,data:Record<string,unknown>={})=>{ const result=await executeCommand(rpc,actor,name,id,{operation_id:randomUUID(),expected_revision:revision,data}); revision=result.revision; return result; };
    const preview=await previewTournament(rpc,actor,id);
    await run('publishTournament',{reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]});
    let snapshot=await getSnapshot(rpc,actor,id);
    for(const user of [player,stranger]) await run('addRegisteredEntry',{definition_id:snapshot.event!.definition_id,player_ids:[user],entry_name:user===player?'Alpha':'Beta',reason:'Administrator enrolled existing account.'});
    await run('closeRegistration'); snapshot=await getSnapshot(rpc,actor,id);
    await run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});
    await run('startTournament'); snapshot=await getSnapshot(rpc,actor,id);
    const match=snapshot.matches[0].id;
    await assert.rejects(run('setDuprSubmission',{match_id:match,enabled:true}),/current event state/i);
    await run('attestScore',{match_id:match,score_a:11,score_b:5,outcome_kind:'played',reason:'Validated final result.'});
    snapshot=await getSnapshot(rpc,actor,id);
    assert.equal(snapshot.event!.modular_state,'completed');
    const request={match_id:match,enabled:true};
    await assert.rejects(executeCommand(rpc,{id:player,clientId:'web'},'setDuprSubmission',id,{operation_id:randomUUID(),expected_revision:revision,data:request}),/permission|forbidden/i);
    await assert.rejects(command(db,{event:id,command:'setDuprSubmission',revision,request,effects:{matches:[{id:match,submit_to_dupr:true,score_a:99}]}}),/INVALID_EFFECTS/);
    const operation={operation_id:randomUUID(),expected_revision:revision,data:request};
    const receipt=await executeCommand(rpc,actor,'setDuprSubmission',id,operation);
    assert.deepEqual(await executeCommand(rpc,actor,'setDuprSubmission',id,operation),receipt);
    await assert.rejects(executeCommand(rpc,actor,'setDuprSubmission',id,{...operation,operation_id:randomUUID()}),/changed|stale/i);
    snapshot=await getSnapshot(rpc,actor,id);
    assert.equal(snapshot.matches[0].submit_to_dupr,true);
    assert.equal(snapshot.matches[0].score_a,11);
    for(const invalid of [{is_current:false},{voided_at:'2026-10-29'},{excluded_at:'2026-10-29'},{outcome_kind:'walkover'},{status:'score_entered'}]) {
      const copy=structuredClone(snapshot);Object.assign(copy.matches[0],invalid);
      assert.throws(()=>planCommand(copy,actor,'setDuprSubmission',request,{now:new Date().toISOString(),id:randomUUID}),/current validated played/);
    }
    const reviewed=structuredClone(snapshot);reviewed.event!.results_under_review=true;
    assert.throws(()=>planCommand(reviewed,actor,'setDuprSubmission',request,{now:new Date().toISOString(),id:randomUUID}),/under review/);
  } finally { await db.close(); }
});
