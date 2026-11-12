import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planAdminFillPosition } from '../../lib/tournament-builder/admin-fill-position';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';

test('filling an existing vacancy preserves complete past identities and scheduled fixtures', () => {
 const owner=randomUUID(), team=randomUUID(), teammate=randomUUID(), newcomer=randomUUID(), former=randomUUID(), definitionId=randomUUID();
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.registration={...definition.registration,entry_type:'fixed_doubles',max_entries:3};
 const past={id:randomUUID(),team_a_id:team,team_b_id:randomUUID(),status:'validated',started_at:'2026-01-01T00:00:00Z',score_a:11,score_b:4,player_a1_id:teammate,player_a2_id:former};
 const future={id:randomUUID(),team_a_id:team,team_b_id:randomUUID(),status:'scheduled'};
 const snapshot:CommandSnapshot={event:{id:randomUUID(),created_by:owner,definition_id:definitionId,modular_state:'active',roster_revision:3},definitions:[{id:definitionId,definition}],teams:[{id:team,entry_state:'approved',registration_slot:1}],team_members:[{id:randomUUID(),team_id:team,user_id:teammate,membership_status:'active',player_slot:1}],tournament_players:[{id:randomUUID(),user_id:teammate,status:'approved'}],matches:[past,future],stages:[],rounds:[],standings:[]};
 const actor={id:owner,clientId:'web'}, data={user_id:newcomer,slot_index:1,position:2,reason:'Fill vacancy'}, context={now:new Date().toISOString(),id:randomUUID};
 const plan=planAdminFillPosition(snapshot,actor,data,context);
 assert.equal(plan.effects.team_members?.[0].team_id,team);
 assert.equal(plan.effects.team_members?.[0].consented_at,null);
 assert.equal(plan.effects.matches,undefined);
 assert.equal(snapshot.matches[0].player_a2_id,former);
 const missing=structuredClone(snapshot); missing.matches[0].player_a2_id=null;
 assert.throws(()=>planAdminFillPosition(missing,actor,data,context),{code:'STRUCTURE_LOCKED'});
 Object.assign(missing.matches[0],{status:'walkover',outcome_kind:'walkover',started_at:null,score_a:null,score_b:null});
 assert.doesNotThrow(()=>planAdminFillPosition(missing,actor,data,context));
 missing.matches[0].started_at='2026-01-01T00:00:00Z';
 assert.throws(()=>planAdminFillPosition(missing,actor,data,context),{code:'STRUCTURE_LOCKED'});
 const frozen=structuredClone(snapshot); frozen.matches[1].player_a1_id=teammate;
 assert.deepEqual(planAdminFillPosition(frozen,actor,data,context).effects.matches,[{id:future.id,player_a2_id:newcomer}]);
 frozen.matches[1].team_b_id=team; frozen.matches[1].team_a_id=randomUUID(); frozen.matches[1].player_a1_id=null; frozen.matches[1].player_b2_id=teammate;
 assert.deepEqual(planAdminFillPosition(frozen,actor,data,context).effects.matches,[{id:future.id,player_b1_id:newcomer}]);
 frozen.matches[1].team_a_id=team; frozen.matches[1].team_b_id=randomUUID(); frozen.matches[1].player_b2_id=null;
 frozen.matches[1].player_a1_id=former;
 assert.throws(()=>planAdminFillPosition(frozen,actor,data,context),{code:'STRUCTURE_LOCKED'});
});


test('full capacity reports unassigned players while allowing an approved player to fill the vacancy', () => {
 const owner=randomUUID(), team=randomUUID(), teammate=randomUUID(), unassigned=randomUUID(), newcomer=randomUUID(), definitionId=randomUUID();
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.registration={...definition.registration,entry_type:'fixed_doubles',max_entries:1};
 const snapshot:CommandSnapshot={event:{id:randomUUID(),created_by:owner,definition_id:definitionId,modular_state:'registration_open',roster_revision:1},definitions:[{id:definitionId,definition}],teams:[{id:team,entry_state:'approved',registration_slot:1}],team_members:[{id:randomUUID(),team_id:team,user_id:teammate,membership_status:'active',player_slot:1},{id:randomUUID(),team_id:team,user_id:unassigned,membership_status:'cancelled',player_slot:2}],tournament_players:[{id:randomUUID(),user_id:teammate,status:'approved'},{id:randomUUID(),user_id:unassigned,status:'approved'}],matches:[],stages:[],rounds:[],standings:[]};
 const actor={id:owner,clientId:'web'}, data={user_id:newcomer,slot_index:1,position:2,reason:'Fill vacancy'}, context={now:new Date().toISOString(),id:randomUUID};
 assert.throws(()=>planAdminFillPosition(snapshot,actor,data,context),{code:'CAPACITY_FULL',message:/registered players have no position/i});
 assert.equal(planAdminFillPosition(snapshot,actor,{...data,user_id:unassigned},context).effects.team_members?.[0].user_id,unassigned);
 snapshot.tournament_players[1].status='rejected';
 assert.equal(planAdminFillPosition(snapshot,actor,data,context).effects.team_members?.[0].user_id,newcomer);
});
