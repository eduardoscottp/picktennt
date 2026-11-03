import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, command, role, owner, player, stranger } from './helpers/storage-db';
let db: PGlite;
before(async()=>{db=await storageDatabase();});
after(async()=>{await db?.close();});
const uuid=()=>crypto.randomUUID();
async function fixture(){
 const event=uuid(),definition=uuid(),stage=uuid(),round=uuid(),a=uuid(),b=uuid(),c=uuid(),first=uuid(),second=uuid();
 await command(db,{event,effects:{definition:{id:definition,definition:{scheduling:{minimum_rest_minutes:15}},status:'draft'},event:{definition_id:definition,court_count:2}}});
 await command(db,{event,command:'publishTournament',revision:1,effects:{definition:{id:definition,definition:{scheduling:{minimum_rest_minutes:15}},status:'published'},event:{modular_state:'registration_open'}}});
 await command(db,{event,command:'closeRegistration',revision:2,effects:{event:{modular_state:'registration_closed'}}});
 await command(db,{event,command:'lockRoster',revision:3,effects:{event:{modular_state:'ready'},stages:[{id:stage,definition_id:definition,node_id:'rr',module_id:'round_robin',module_version:1,state:'active'}],teams:[{id:a,entry_state:'approved'},{id:b,entry_state:'approved'},{id:c,entry_state:'approved'}],team_members:[{id:uuid(),team_id:a,user_id:owner},{id:uuid(),team_id:b,user_id:player},{id:uuid(),team_id:c,user_id:stranger}],rounds:[{id:round,stage_id:stage,round_number:1,round_type:'round_robin',schedule_generation:1}],matches:[{id:first,round_id:round,stage_id:stage,logical_key:'first',schedule_generation:1,team_a_id:a,team_b_id:b},{id:second,round_id:round,stage_id:stage,logical_key:'second',schedule_generation:1,team_a_id:a,team_b_id:c}]}});
 await command(db,{event,command:'startTournament',revision:4,effects:{event:{modular_state:'active'}}});
 return {event,first,second};
}
const start=(f:Awaited<ReturnType<typeof fixture>>,revision:number,reason?:unknown,actor=owner,court=2)=>({event:f.event,command:'startMatch',revision,actor,request:{match_id:f.second,...(reason===undefined?{}:{rest_override_reason:reason})},effects:{matches:[{id:f.second,status:'in_progress',court_number:court,started_at:new Date().toISOString()}]}});
async function recent(f:Awaited<ReturnType<typeof fixture>>){
 await command(db,{event:f.event,command:'startMatch',revision:5,request:{match_id:f.first},effects:{matches:[{id:f.first,status:'in_progress',court_number:1,started_at:new Date().toISOString()}]}});
 await command(db,{event:f.event,command:'attestScore',revision:6,effects:{matches:[{id:f.first,status:'validated',outcome_kind:null,is_current:false,voided_at:new Date().toISOString(),ended_at:new Date().toISOString()}]}});
}
test('owner rest-only override commits audited reason and stable replay; legacy override requests remain compatible',async()=>{
 const f=await fixture();await recent(f);
 const operation=uuid(),input={...start(f,7,' Testing synthetic schedule '),operation};
 const receipt=await command(db,input);assert.equal(receipt.revision,8);
 const audit=(await db.query<{request:{rest_override_reason:string};prior_revision:number;revision:number}>('SELECT request,prior_revision,revision FROM tournament_operations WHERE operation_id=$1',[operation])).rows[0];
 assert.equal(audit.request.rest_override_reason,' Testing synthetic schedule ');assert.equal(Number(audit.prior_revision),7);assert.equal(Number(audit.revision),8);
 await command(db,{event:f.event,command:'cancelTournament',revision:8,effects:{event:{modular_state:'cancelled'}}});
 assert.deepEqual(await command(db,input),receipt);
 assert.equal(Number((await db.query<{n:number}>('SELECT count(*) n FROM tournament_operations WHERE operation_id=$1',[operation])).rows[0].n),1);
});
test('current tournament admin may override; ordinary participant cannot even when no rest is due',async()=>{
 const f=await fixture();
 await assert.rejects(command(db,start(f,5,'Player requested',stranger)),/FORBIDDEN/);
 // Fixture-only setup of an existing delegated admin; production enrollment never writes this context.
 await db.transaction(async tx=>{await tx.query('INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),$1)',[f.event]);await tx.query('INSERT INTO tournament_admins(tournament_id,user_id,succession_order,granted_by) VALUES($1,$2,2,$3)',[f.event,stranger,owner]);await tx.query('DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current()');});
 await recent(f);await command(db,start(f,7,'Admin-approved synthetic test',stranger));
});
test('invalid override reasons roll back the whole command with no receipt, context, revision or match residue',async()=>{
 const f=await fixture();await recent(f);
 for(const reason of [null,42,true,{},[], '', ' \t\r\n ', 'x'.repeat(501)]){
  const operation=uuid();await assert.rejects(command(db,{...start(f,7,reason),operation}),/INVALID_REQUEST/);
  assert.equal(Number((await db.query<{n:number}>('SELECT count(*) n FROM tournament_operations WHERE operation_id=$1',[operation])).rows[0].n),0);
 }
 assert.equal(Number((await db.query<{revision:number}>('SELECT revision FROM tournaments WHERE id=$1',[f.event])).rows[0].revision),7);
 assert.equal((await db.query<{status:string}>('SELECT status FROM matches WHERE id=$1',[f.second])).rows[0].status,'scheduled');
 assert.equal(Number((await db.query<{n:number}>('SELECT count(*) n FROM tournament_builder_private.command_context')).rows[0].n),0);
 await command(db,start(f,7,'x'.repeat(500)));
});
test('override preserves live court and player busy checks and ordinary RPC denial',async()=>{
 const f=await fixture();
 await command(db,{event:f.event,command:'startMatch',revision:5,request:{match_id:f.first},effects:{matches:[{id:f.first,status:'in_progress',court_number:1,started_at:new Date().toISOString()}]}});
 await assert.rejects(command(db,start(f,6,'Override cannot bypass court',owner,1)),/COURT_BUSY/);
 await assert.rejects(command(db,start(f,6,'Override cannot bypass player')),/PLAYER_BUSY/);
 for(const caller of ['anon','authenticated'] as const)await assert.rejects(role(db,caller,owner,()=>db.query('SELECT public.tb_apply_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[owner,'web',uuid(),'a'.repeat(64),'startMatch',f.event,6,JSON.stringify({match_id:f.second,rest_override_reason:'forged'}),'{}','{}',null])),/permission denied/);
 const meta=(await db.query<{prosecdef:boolean;proconfig:string[]}>('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',['public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'])).rows[0];
 assert.equal(meta.prosecdef,true);assert.deepEqual(meta.proconfig,['search_path=pg_catalog, public']);
});




