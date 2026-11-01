import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DomainError, parseEnvelope, UUID } from './requests';
import { graphNodeSchemas, definitionJsonSchema } from './definition-schema';
export interface AdminMcpDependencies {
 snapshot(id:string):Promise<unknown>;
 findPlayer(id:string,username:string):Promise<unknown>;
 previewCorrection(id:string,data:Record<string,unknown>):Promise<unknown>;
 previewWithdrawal(id:string,data:Record<string,unknown>):Promise<unknown>;
 previewRevision?(id:string,data:Record<string,unknown>):Promise<unknown>;
 previewSchedule?(id:string,data:Record<string,unknown>):Promise<unknown>;
}
const uuid={type:'string',format:'uuid'}, text={type:'string',minLength:1,maxLength:1000}, integer={type:'integer',minimum:0};
const object=(properties:Record<string,object>,required:string[]=Object.keys(properties))=>({type:'object' as const,properties,required,additionalProperties:false});
const result=object({match_id:uuid,score_a:integer,score_b:integer,outcome_kind:{type:'string',enum:['played','retirement','walkover','no_contest']},winner_entry_id:uuid,reason:text},['match_id','outcome_kind','reason']);
const revisionData=object({definition:definitionJsonSchema(true),entries:{type:'array',maxItems:32,items:object({entry_id:uuid,entry_name:{...text,maxLength:120},player_ids:{type:'array',items:uuid,maxItems:2},remove:{type:'boolean'}},['entry_id'])},reason:text},['definition','reason']);
const scheduleData=object({reviewed_roster_revision:integer,nodes:{type:'array',minItems:4,maxItems:64,items:{oneOf:graphNodeSchemas()}},group_assignments:{type:'object',additionalProperties:{type:'array',items:uuid,minItems:2,maxItems:16,uniqueItems:true}},preview_hash:text},['reviewed_roster_revision']);
const specs:Record<string,{command:string;data:ReturnType<typeof object>;structural?:boolean;description:string}>={
 admin_revise_tournament:{command:'reviseTournament',data:object({...revisionData.properties,preview_hash:text},['definition','reason','preview_hash']),structural:true,description:'Apply an exact admin_preview_revision before any match has started or recorded a result. Confirm the affected teams, fixtures and bracket with the organizer. Preserves prior definitions and fixtures; closes registration. Reopen to add players, then preview and generate the reviewed groups separately. Player swaps are one batch of both teams; references existing accounts and records administrator admission, never personal consent.'},
 admin_update_event_details:{command:'updateEventDetails',data:object({name:{...text,maxLength:120},venue_name:{...text,maxLength:200},reason:text}),description:'Correct the published event name and venue description without changing teams, rules, courts or results; available after play begins.'},
 admin_register_players:{command:'addRegisteredEntry',data:object({definition_id:uuid,player_ids:{type:'array',items:uuid,minItems:1,maxItems:2,uniqueItems:true},entry_name:{...text,maxLength:120},reason:text}),description:'Legacy partner-confirmed registration only. New individual-slot tournaments require each player to join first and use admin_place_registered_player instead.'},
 admin_place_registered_player:{command:'placeRegisteredPlayer',data:object({user_id:uuid,slot_index:{type:'integer',minimum:1,maximum:16}}),description:'Place or move one player who has already joined this individual-slot tournament. Choose only a current registered player from admin_get_tournament; this never creates an account or enrols an unregistered player.'},
 admin_save_result:{command:'attestScore',data:result,description:'Save and validate a final result as tournament administrator. No Start action needed. Read the current published scoring policy and match IDs first; include a short decision reason. Played results need legal final scores. This advances eligible rounds and final placements.'},
 admin_resolve_dispute:{command:'adjudicateDispute',data:result,description:'Resolve a disputed result using current match and an explicit reason.'},
 admin_approve_entry:{command:'approveEntry',data:object({entry_id:uuid}),description:'Approve an existing complete entry during registration.'},
 admin_reject_entry:{command:'rejectEntry',data:object({entry_id:uuid,reason:text}),description:'Reject a pending entry with an explanation.'},
 admin_close_registration:{command:'closeRegistration',data:object({}),structural:true,description:'Close registration after explaining the consequence and obtaining organizer confirmation.'},
 admin_reopen_registration:{command:'reopenRegistration',data:object({}),structural:true,description:'Reopen registration before its published deadline after organizer confirmation.'},
 admin_lock_roster:{command:'lockRoster',data:scheduleData,structural:true,description:'Finalize groups and generate fixtures only after registration closes and the admin reviews the actual roster and groups. Supply group_assignments mapping each initial seeded group node ID to its actual approved entry UUIDs; cover the roster exactly once, at least two entries per group, within capacity. Required when underfilled. Optional nodes completes a pending knockout while preserving all published nodes and supplied connections. No players or fixtures are needed when creating or publishing registration. Pending qualification must be supported and complete before this action. Show actual groups and the completed format, obtain confirmation, and use the current roster revision.'},
 admin_start_tournament:{command:'startTournament',data:object({}),structural:true,description:'Activate the tournament after the organizer confirms the generated fixtures.'},
 admin_resolve_tie:{command:'resolveTie',data:object({stage_id:uuid,entry_ids:{type:'array',items:uuid,minItems:2,uniqueItems:true},input_revision:integer}),structural:true,description:'Record a draw for an entire current tied group only after explaining affected qualification/seeds and obtaining organizer confirmation.'},
 admin_change_court:{command:'changeCourt',data:object({match_id:uuid,court_number:{type:'integer',minimum:1,maximum:8}}),description:'Move an unplayed fixture to a free court. Does not edit results or regenerate the bracket.'},
 admin_commit_correction:{command:'commitCorrection',data:object({...result.properties,preview_hash:text,resolution:{type:'string',enum:['ordinary','void_and_replay']}},['match_id','outcome_kind','reason','preview_hash','resolution']),structural:true,description:'Apply an exact current admin_preview_correction. Explain all affected games, results and replays first, ask whether to proceed, and set confirmed_structure_change only after approval. A stale preview must be regenerated.'},
 admin_withdraw_entry:{command:'withdrawEntry',data:object({entry_id:uuid,reason:text,preview_hash:text}),structural:true,description:'Apply an exact admin_preview_withdrawal only after explaining affected games/qualification/results and obtaining organizer confirmation.'},
};
const correctionPreview=object({match_id:uuid,score_a:integer,score_b:integer,outcome_kind:result.properties.outcome_kind,winner_entry_id:uuid},['match_id','outcome_kind']);
const reads={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
export const ADMIN_TOOLS:Tool[]=[
 {name:'admin_preview_revision',description:'Preview a complete replacement definition and optional edits/removals to existing entries before play. Return affected fixture IDs and bracket stages, warnings, and exact preview hash. Does not generate or change anything.',inputSchema:object({tournament_id:uuid,data:revisionData}),annotations:reads},
 {name:'admin_preview_schedule',description:'Preview actual roster/group fixtures, court slots, waiting metrics and unequal game counts before generation. Use its preview_hash with admin_lock_roster to generate this exact schedule.',inputSchema:object({tournament_id:uuid,data:scheduleData}),annotations:reads},
 {name:'admin_get_tournament',description:'Read current tournament definition, role, revision, registered-account roster, games, standings and final placements. Only tournaments you currently administer are accessible. Matches are returned in pages of 64; pass match_page.next_offset as match_offset to read the next page at the same tournament revision.',inputSchema:object({tournament_id:uuid,match_offset:{type:'integer',minimum:0,maximum:1000000}},['tournament_id']),annotations:reads},
 {name:'admin_find_player',description:'Look up an existing Picktennt profile by exact username for this tournament. Never create a substitute account or infer participant consent.',inputSchema:object({tournament_id:uuid,username:{type:'string',pattern:'^[a-zA-Z0-9_]{3,32}$'}}),annotations:reads},
 ...['correction','withdrawal'].map(kind=>({name:`admin_preview_${kind}`,description:`Read the concrete current ${kind} impact before asking the organizer whether to proceed. No changes are made.`,inputSchema:object({tournament_id:uuid,data:kind==='correction'?correctionPreview:object({entry_id:uuid,reason:text})}),annotations:reads})),
 ...Object.entries(specs).map(([name,spec])=>({name,description:spec.description,inputSchema:object({tournament_id:uuid,operation_id:uuid,expected_revision:integer,data:spec.data,...(spec.structural?{confirmed_structure_change:{type:'boolean',const:true}}:{})}),annotations:{readOnlyHint:false,destructiveHint:!!spec.structural,idempotentHint:true,openWorldHint:false}})),
];
export async function callAdminTool(name:string,args:Record<string,unknown>,admin:AdminMcpDependencies,execute:(command:string,id:string,input:unknown)=>Promise<unknown>):Promise<unknown>{
 const id=args.tournament_id;if(typeof id!=='string'||!UUID.test(id))throw new DomainError('INVALID_REQUEST','A tournament UUID is required.');
 if(name==='admin_get_tournament')return admin.snapshot(id);
 if(name==='admin_find_player'){
  if(typeof args.username!=='string'||! /^[a-zA-Z0-9_]{3,32}$/.test(args.username))throw new DomainError('INVALID_REQUEST','Provide the exact Picktennt username.');
  return admin.findPlayer(id,args.username.toLowerCase());
 }
 const data=args.data;if(!data||typeof data!=='object'||Array.isArray(data))throw new DomainError('INVALID_REQUEST','Provide command data.');
 if(name==='admin_preview_correction')return admin.previewCorrection(id,data as Record<string,unknown>);
 if(name==='admin_preview_withdrawal')return admin.previewWithdrawal(id,data as Record<string,unknown>);
 if(name==='admin_preview_revision'&&admin.previewRevision)return admin.previewRevision(id,data as Record<string,unknown>);
 if(name==='admin_preview_schedule'&&admin.previewSchedule)return admin.previewSchedule(id,data as Record<string,unknown>);
 const spec=specs[name];if(!spec)throw new DomainError('INVALID_REQUEST','Unknown administrator tool.');
 if(spec.structural&&args.confirmed_structure_change!==true)throw new DomainError('CONFIRMATION_REQUIRED','Explain the concrete structural impact and ask the organizer whether to proceed before applying this change.');
 return execute(spec.command,id,parseEnvelope({operation_id:args.operation_id,expected_revision:args.expected_revision,data}));
}
