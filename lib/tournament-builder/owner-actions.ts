import type { CommandActor, CommandSnapshot, StorageRow } from './commands';
import { definitionHash, DomainError, UUID } from './requests';
import { previewDefinition } from './preview';
export const OWNER_ACTIONS=['publishTournament','cancelTournament','reopenResults','addAdministrator','removeAdministrator'] as const;
export type OwnerAction=typeof OWNER_ACTIONS[number];
const fail=(code:string,message:string):never=>{throw new DomainError(code,message);};
export function isOwnerAction(action:string):action is OwnerAction{return (OWNER_ACTIONS as readonly string[]).includes(action);}
export function previewOwnerAction(snapshot:CommandSnapshot,actor:CommandActor,action:string,input:Record<string,unknown>={}){
 const event=snapshot.event;
 if(!event||event.created_by!==actor.id||(actor.clientId!=='web'&&!actor.permissions?.includes('owner:manage')))fail('FORBIDDEN','Current owner access and explicit owner permission are required.');
 if(!isOwnerAction(action))fail('INVALID_COMMAND','Unsupported owner action.');
 const base=Object.fromEntries(Object.entries(input).filter(([key])=>!['confirmed_owner_action','reviewed_action_hash'].includes(key)));
 let data:Record<string,unknown>,impact:Record<string,unknown>;
 if(action==='publishTournament'){
  if(event!.modular_state!=='draft')fail('INVALID_STATE','Only a draft can be published.');
  if(Object.keys(base).some(key=>!['reviewed_definition_hash','acknowledged_warning_codes'].includes(key)))fail('INVALID_REQUEST','Unexpected publication field.');
  const definition=snapshot.definitions.find(d=>d.id===event!.definition_id)??snapshot.definitions.at(-1);
  const review=previewDefinition(definition?.definition??{},Number(event!.revision));
  if(!review.valid||!review.definitionHash)fail('INVALID_DEFINITION','Resolve all missing decisions and errors before publication.');
  const warnings=[...(review.warningCodes??[])].sort();
  if((base.reviewed_definition_hash!==undefined&&base.reviewed_definition_hash!==review.definitionHash)||(base.acknowledged_warning_codes!==undefined&&JSON.stringify(base.acknowledged_warning_codes)!==JSON.stringify(warnings)))fail('STALE_PREVIEW','Review the exact current definition and warnings.');
  data={reviewed_definition_hash:review.definitionHash,acknowledged_warning_codes:warnings};
  impact={opens_registration:true,players_enrolled:0,definition:definition!.definition,warnings:review.warnings,maximum_matches:review.maximumMatches??null};
 }else{
  const roleChange=action==='addAdministrator'||action==='removeAdministrator';
  if(Object.keys(base).some(key=>!(roleChange?['user_id','reason']:['reason']).includes(key)))fail('INVALID_REQUEST','Unexpected owner action field.');
  if(typeof base.reason!=='string'||!base.reason.trim()||base.reason.length>1000)fail('INVALID_REQUEST','Provide a short explicit reason.');
  data={reason:(base.reason as string).trim()};
  const matches=snapshot.matches.filter(m=>m.is_current!==false&&!m.voided_at);
  if(action==='cancelTournament'){
   if(['completed','cancelled'].includes(String(event!.modular_state)))fail('INVALID_STATE','This tournament cannot be cancelled in its current state.');
   impact={new_state:'cancelled',affected_match_ids:matches.filter(m=>!['validated','walkover'].includes(String(m.status))).map(m=>m.id).sort(),accepted_results_preserved:matches.filter(m=>['validated','walkover'].includes(String(m.status))).map(m=>m.id).sort(),champion_will_not_be_invented:true};
  }else if(action==='reopenResults'){
   if(event!.modular_state!=='completed')fail('INVALID_STATE','Only completed results can be reopened.');
   impact={new_state:'active',results_under_review:true,final_placements_withheld:true,preserved_match_ids:matches.map(m=>m.id).sort()};
  }else{
   if(typeof base.user_id!=='string'||!UUID.test(base.user_id))fail('INVALID_REQUEST','Select an existing Picktennt profile UUID.');
   const userId=(base.user_id as string).toLowerCase();
   if(action==='removeAdministrator'&&userId===event!.created_by)fail('FORBIDDEN','The tournament owner cannot be removed.');
   const admins=(('admins' in snapshot&&Array.isArray(snapshot.admins))?snapshot.admins:[]) as StorageRow[];
   const existing=admins.some(row=>row.user_id===userId)||userId===event!.created_by;
   if(action==='addAdministrator'&&existing)fail('INVALID_STATE','This account is already a tournament administrator.');
   if(action==='removeAdministrator'&&!existing)fail('INVALID_STATE','This account is not a tournament administrator.');
   data.user_id=userId;
   impact={target_profile_id:userId,permission_change:action==='addAdministrator'?'grant_tournament_administrator':'remove_tournament_administrator',current_administrator_ids:admins.map(row=>String(row.user_id)).sort(),owner_protected:true,does_not_transfer_ownership:true};
  }
 }
 const payload={tournament_id:event!.id,event_revision:Number(event!.revision),action,data,impact};
 return {...payload,preview_hash:definitionHash(payload)};
}
export function requireReviewedOwnerAction(snapshot:CommandSnapshot,actor:CommandActor,action:string,data:Record<string,unknown>){
 if(data.confirmed_owner_action!==true||typeof data.reviewed_action_hash!=='string')fail('CONFIRMATION_REQUIRED','Show the current owner action preview and ask the owner whether to proceed.');
 const preview=previewOwnerAction(snapshot,actor,action,data);
 if(data.reviewed_action_hash!==preview.preview_hash)fail('STALE_PREVIEW','The owner action or tournament changed. Preview and confirm it again.');
 return preview;
}
