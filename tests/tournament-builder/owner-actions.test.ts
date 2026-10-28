import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewOwnerAction } from '../../lib/tournament-builder/owner-actions';
const actor={id:randomUUID(),clientId:'claude',permissions:['owner:manage']};
const context={now:'2026-10-28T23:00:00Z',id:randomUUID};
function snapshot(state='active'):CommandSnapshot{return {event:{id:randomUUID(),created_by:actor.id,modular_state:state,revision:7},definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[],admins:[]};}
function proof(s:CommandSnapshot,action:string,data:Record<string,unknown>){const p=previewOwnerAction(s,actor,action,data);return {...p.data,confirmed_owner_action:true,reviewed_action_hash:p.preview_hash};}
test('assistant owner publication binds complete definition, warnings, revision and explicit confirmation',()=>{
 const s=snapshot('draft'),definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 const definitionId=randomUUID();s.definitions=[{id:definitionId,definition}];s.event!.definition_id=definitionId;
 const p=previewOwnerAction(s,actor,'publishTournament',{}),data=proof(s,'publishTournament',{});
 assert.deepEqual(p.impact.definition,definition);assert.equal(p.impact.players_enrolled,0);
 assert.equal(planCommand(s,actor,'publishTournament',data,context).effects.event!.modular_state,'registration_open');
 assert.throws(()=>planCommand(s,actor,'publishTournament',{...data,confirmed_owner_action:false},context),{code:'CONFIRMATION_REQUIRED'});
 const newer=structuredClone(s);newer.event!.revision=8;
 assert.throws(()=>planCommand(newer,actor,'publishTournament',data,context),{code:'STALE_PREVIEW'});
});
test('owner cancellation and reopening cannot reuse proofs or bypass actual ownership and consent scopes',()=>{
 const s=snapshot(),data=proof(s,'cancelTournament',{reason:'Owner stops this test'});
 assert.equal(planCommand(s,actor,'cancelTournament',data,context).effects.event!.modular_state,'cancelled');
 assert.throws(()=>planCommand(s,actor,'cancelTournament',{...data,reason:'Different reason'},context),{code:'STALE_PREVIEW'});
 for(const bad of [{...actor,permissions:['admin:manage']},{...actor,id:randomUUID(),role:'owner' as const}]) assert.throws(()=>planCommand(s,bad,'cancelTournament',data,context),{code:'FORBIDDEN'});
 const completed=snapshot('completed');completed.definitions=[{id:randomUUID(),definition:JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'))}];
 const reopen=proof(completed,'reopenResults',{reason:'Review disputed final'});
 const effect=planCommand(completed,actor,'reopenResults',reopen,context).effects.event!;
 assert.equal(effect.results_under_review,true);assert.equal(effect.modular_state,'active');
 assert.throws(()=>planCommand(s,actor,'reopenResults',reopen,context),{code:'INVALID_STATE'});
});
test('administrator delegation proof binds target account and current administrator set',()=>{
 const s=snapshot(),userId=randomUUID(),data=proof(s,'addAdministrator',{user_id:userId,reason:'Helper for event'});
 assert.equal(planCommand(s,actor,'addAdministrator',data,context).effects.admin_change!.user_id,userId);
 assert.throws(()=>planCommand(s,actor,'addAdministrator',{...data,user_id:randomUUID()},context),{code:'STALE_PREVIEW'});
 s.admins!.push({id:randomUUID(),user_id:randomUUID()});
 assert.throws(()=>planCommand(s,actor,'addAdministrator',data,context),{code:'STALE_PREVIEW'});
});
