import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { planCommand, type CommandSnapshot, type CommandActor } from '../../lib/tournament-builder/commands';
import { previewOwnerAction } from '../../lib/tournament-builder/owner-actions';
const owner={id:randomUUID(),clientId:'web'}, delegate={id:randomUUID(),clientId:'web',role:'admin' as const};
const context={now:'2026-10-28T23:00:00Z',id:randomUUID};
function snapshot():CommandSnapshot{return {event:{id:randomUUID(),created_by:owner.id,modular_state:'active',revision:7},definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[],admins:[{id:randomUUID(),user_id:owner.id,succession_order:1,granted_by:owner.id},{id:randomUUID(),user_id:delegate.id,succession_order:2,granted_by:owner.id}]};}
function reviewed(s:CommandSnapshot,actor:CommandActor,action:string,data:Record<string,unknown>){return {...data,confirmed_owner_action:true,reviewed_action_hash:previewOwnerAction(s,actor,action,data).preview_hash};}
test('reviewed owner role commands produce one audited administrator change and no roster/game effects',()=>{
 const s=snapshot(),userId=randomUUID();
 const add=planCommand(s,owner,'addAdministrator',reviewed(s,owner,'addAdministrator',{user_id:userId,reason:'Add tournament helper'}),context);
 assert.deepEqual(Object.keys(add.effects),['admin_change']);assert.equal(add.effects.admin_change!.action,'add');assert.equal(add.effects.admin_change!.user_id,userId);
 const remove=planCommand(s,owner,'removeAdministrator',reviewed(s,owner,'removeAdministrator',{user_id:delegate.id,reason:'Remove helper access'}),context);
 assert.deepEqual(remove.effects.admin_change,{action:'remove',id:s.admins![1].id,user_id:delegate.id});
 assert.equal(s.admins!.length,2);
});
test('role commands reject delegated administrators, owner removal, unknown users and duplicate grants',()=>{
 const s=snapshot();
 assert.throws(()=>planCommand(s,delegate,'addAdministrator',{user_id:randomUUID(),reason:'Not owner'},context),{code:'FORBIDDEN'});
 assert.throws(()=>planCommand(s,owner,'removeAdministrator',{user_id:owner.id,reason:'Remove owner',confirmed_owner_action:true,reviewed_action_hash:'a'.repeat(64)},context),{code:'FORBIDDEN'});
 assert.throws(()=>planCommand(s,owner,'addAdministrator',{user_id:delegate.id,reason:'Already admin',confirmed_owner_action:true,reviewed_action_hash:'a'.repeat(64)},context),{code:'INVALID_STATE'});
 assert.throws(()=>planCommand(s,owner,'removeAdministrator',{user_id:randomUUID(),reason:'Not admin',confirmed_owner_action:true,reviewed_action_hash:'a'.repeat(64)},context),{code:'INVALID_STATE'});
});
