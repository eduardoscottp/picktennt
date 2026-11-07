import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { command, owner, storageDatabase } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { validateGraph } from '../../lib/tournament-builder/graph-validate';

test('published status alone does not prove graph validation at the SQL effects boundary', async () => {
 const db=await storageDatabase();
 try {
  const d=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
  d.schema_version='2.0'; d.event.starts_at='2030-11-07T09:00:00-05:00'; d.event.expected_end_at='2030-11-07T12:30:00-05:00';
  d.registration={...d.registration,entry_type:'singles',partner_consent:false,min_entries:2,max_entries:2,closes_at:'2030-11-06T18:00:00-05:00'};
  d.nodes=[{id:'reg',module:'registration@1'},{id:'entries',module:'entries@1',from:'reg'},{id:'final',module:'match@1',inputs:[{kind:'seed',seed:1},{kind:'seed',seed:2}]},{id:'places',module:'placements@2',final:'final'}];
  const event=randomUUID(),actor={id:owner,clientId:'web'},context={now:'2026-10-28T12:00:00Z',id:randomUUID};
  const empty:CommandSnapshot={event:null,definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[]};
  const draft=planCommand(empty,actor,'createDraft',{definition:d},context);
  await command(db,{event,command:'createDraft',revision:null,request:{definition:d},effects:draft.effects,result:draft.result});
  const snapshot=(await db.query<{value:CommandSnapshot}>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value',[owner,'web',event,null])).rows[0].value;
  const preview=previewDefinition(d,Number(snapshot.event!.revision));
  const request={reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes??[]};
  const publish=planCommand(snapshot,actor,'publishTournament',request,context);
  const invalid=structuredClone(d); invalid.nodes.find((node:{id:string})=>node.id==='final').inputs[1]={kind:'seed',seed:1};
  assert.ok(validateGraph(invalid).length>0);
  publish.effects.definition!.definition=invalid;
  await command(db,{event,command:'publishTournament',revision:Number(snapshot.event!.revision),request,effects:publish.effects,result:publish.result});
  const saved=(await db.query<{status:string,definition:typeof d}>('SELECT status,definition FROM public.tournament_definitions WHERE tournament_id=$1',[event])).rows[0];
  assert.equal(saved.status,'published'); assert.ok(validateGraph(saved.definition).length>0);
 } finally { await db.close(); }
});
