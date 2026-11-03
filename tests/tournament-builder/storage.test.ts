import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner, player, stranger } from './helpers/storage-db';
let db: PGlite;
before(async () => { db = await storageDatabase(); });
after(async () => { await db?.close(); });
const uuid = () => crypto.randomUUID();

async function create() { const event=uuid(); await command(db,{event}); return event; }
async function count(table:string,event:string) { return Number((await db.query<{n:number}>(`SELECT count(*) AS n FROM ${table} WHERE tournament_id=$1`,[event])).rows[0].n); }

test('storage foundation installs command boundary without replacing legacy tables', async () => {
  const rows=await db.query<{name:string|null}>("SELECT to_regclass('public.tournament_operations')::text AS name");
  assert.equal(rows.rows[0].name,'tournament_operations');
});

test('draft effects, auto-owner, revision and receipt commit together; identical names allowed',async()=>{
  const event=await create(); const other=await create(); assert.notEqual(event,other);
  const rows=await db.query<{revision:number;engine_version:string}>('SELECT revision,engine_version FROM tournaments WHERE id=$1',[event]);
  assert.equal(Number(rows.rows[0].revision),1); assert.equal(rows.rows[0].engine_version,'modular_v1');
  assert.equal(await count('tournament_admins',event),1); assert.equal(await count('tournament_operations',event),1);
});

test('receipt replay ignores later lifecycle and stale revision but rejects request hash reuse',async()=>{
  const event=await create(), operation=uuid();
  const input={event,operation,command:'updateDraft',revision:1,effects:{event:{name:'Reviewed draft'}},result:{saved:true}};
  const receipt=await command(db,input);
  await command(db,{event,command:'cancelTournament',revision:2,effects:{event:{modular_state:'cancelled',status:'cancelled'}}});
  assert.deepEqual(await command(db,input),receipt);
  await assert.rejects(command(db,{...input,hash:'b'.repeat(64)}),/IDEMPOTENCY_CONFLICT/);
  assert.equal(await count('tournament_operations',event),3);
});

test('stale and failed multi-row effects leave no revision, fixture or receipt residue',async()=>{
  const event=await create(), team=uuid();
  await assert.rejects(command(db,{event,command:'updateDraft',revision:0,effects:{event:{name:'stale'}}}),/STALE_REVISION/);
  await assert.rejects(command(db,{event,command:'updateDraft',revision:1,effects:{teams:[{id:team,name:'valid'}],team_members:[{id:uuid(),team_id:team,user_id:uuid()}]}}),/foreign key/);
  assert.equal(await count('teams',event),0); assert.equal(await count('tournament_operations',event),1);
  assert.equal(Number((await db.query<{revision:number}>('SELECT revision FROM tournaments WHERE id=$1',[event])).rows[0].revision),1);
});

test('ordinary roles cannot execute trusted effects and service role cannot direct-write modular rows',async()=>{
  const event=await create();
  for(const caller of ['anon','authenticated'] as const) await assert.rejects(role(db,caller,owner,()=>db.query('SELECT tb_get_snapshot($1,$2,$3,NULL)',[owner,'web',event])),/permission denied/);
  for(const caller of ['service_role','authenticated'] as const) await assert.rejects(role(db,caller,owner,()=>db.query("UPDATE tournaments SET name='bypass' WHERE id=$1",[event])),/COMMAND_REQUIRED/);
  await assert.rejects(role(db,'service_role',owner,()=>db.exec("SELECT set_config('tb.command_context','on',false); UPDATE tournaments SET name='forged' WHERE engine_version='modular_v1'")),/COMMAND_REQUIRED/);
  await assert.rejects(role(db,'service_role',owner,()=>db.exec('INSERT INTO tournament_builder_private.command_context VALUES (txid_current(),gen_random_uuid())')),/permission denied/);
});

test('legacy owner and service writes remain usable, including old global name uniqueness',async()=>{
  const id=uuid();
  await role(db,'authenticated',owner,()=>db.query("INSERT INTO tournaments(id,name,created_by,court_count,max_players,type) VALUES($1,'Legacy', $2,1,4,'singles')",[id,owner]));
  await role(db,'authenticated',owner,()=>db.query("UPDATE tournaments SET name='Legacy edited' WHERE id=$1",[id]));
  await role(db,'service_role',owner,()=>db.query("INSERT INTO teams(tournament_id,name) VALUES($1,'legacy team')",[id]));
  assert.equal(await count('teams',id),1);
  await assert.rejects(db.query("INSERT INTO tournaments(name,created_by,court_count,max_players,type) VALUES('Legacy edited',$1,1,4,'singles')",[owner]),/unique/);
});

test('cross-event effects and duplicate active memberships roll back atomically',async()=>{
  const event=await create(), other=await create(), team=uuid();
  await command(db,{event,command:'updateDraft',revision:1,effects:{teams:[{id:team,name:'one'}],team_members:[{id:uuid(),team_id:team,user_id:player}]}});
  await assert.rejects(command(db,{event:other,command:'updateDraft',revision:1,effects:{teams:[{id:team,name:'steal'}]}}),/CROSS_EVENT/);
  const second=uuid();
  await assert.rejects(command(db,{event,command:'updateDraft',revision:2,effects:{teams:[{id:second}],team_members:[{id:uuid(),team_id:second,user_id:player}]}}),/DUPLICATE_ENTRY/);
  assert.equal(await count('teams',event),1);
});

test('current actor and grant permissions are checked before returning historical receipts',async()=>{
  const event=uuid(), grant=uuid(),operation=uuid();
  await db.query("INSERT INTO connection_grants(id,user_id,client_id,provider,permissions) VALUES($1,$2,'connector','test',ARRAY['draft:create','draft:read','draft:update'])",[grant,owner]);
  const input={event,operation,client:'connector',grant}; await command(db,input);
  await db.query("UPDATE connection_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant]);
  await assert.rejects(command(db,input),/GRANT_REVOKED/);
  await assert.rejects(command(db,{event,actor:stranger,command:'updateDraft',revision:1}),/FORBIDDEN/);
});

test('snapshot requires event access, includes only roster display names and excludes profile contact fields',async()=>{
  const event=await create(),team=uuid();
  await command(db,{event,command:'updateDraft',revision:1,effects:{teams:[{id:team}],team_members:[{id:uuid(),team_id:team,user_id:player}]}});
  const snap=await role(db,'service_role',owner,()=>db.query<{snapshot:unknown}>('SELECT tb_get_snapshot($1,$2,$3,NULL) AS snapshot',[owner,'web',event]));
  const value=JSON.stringify(snap.rows[0].snapshot); assert.match(value,/Player/); assert.doesNotMatch(value,/example\.invalid|"email"|is_system_admin/);
  await assert.rejects(role(db,'service_role',stranger,()=>db.query('SELECT tb_get_snapshot($1,$2,$3,NULL)',[stranger,'web',event])),/FORBIDDEN/);
});

test('row guards cover every existing legacy writer, and transaction-context flags cannot bypass them',async()=>{
  const event=await create(),team=uuid();
  await command(db,{event,command:'updateDraft',revision:1,effects:{teams:[{id:team}],team_members:[{id:uuid(),team_id:team,user_id:player}]}});
  const writes=[
    ['DELETE FROM tournament_admins WHERE tournament_id=$1',[event]],
    ['UPDATE teams SET name=\'unsafe\' WHERE tournament_id=$1',[event]],
    ['DELETE FROM team_members WHERE team_id=$1',[team]],
    ["INSERT INTO tournament_players(tournament_id,user_id) VALUES($1,$2)",[event,stranger]],
    ["INSERT INTO rounds(tournament_id,round_number,round_type) VALUES($1,1,'round_robin')",[event]],
    ["INSERT INTO mixed_pairings(tournament_id,player_a_id,player_b_id) VALUES($1,$2,$3)",[event,player,stranger]],
    ["UPDATE tournaments SET engine_version='legacy' WHERE id=$1",[event]],
  ] as const;
  for(const [sql,args] of writes) await assert.rejects(role(db,'service_role',owner,()=>db.query(sql,[...args])),/COMMAND_REQUIRED/);
  await assert.rejects(role(db,'service_role',owner,()=>db.exec('TRUNCATE teams CASCADE')),/COMMAND_REQUIRED|permission denied/);
});

test('unknown effect keys, invalid lifecycle and client-grant mismatches cannot create operations',async()=>{
  const event=await create();
  await assert.rejects(command(db,{event,command:'updateDraft',revision:1,effects:{event:{created_by:stranger}}}),/INVALID_EFFECTS/);
  await assert.rejects(command(db,{event,command:'submitScore',revision:1,request:{match_id:uuid()},effects:{}}),/INVALID_STATE/);
  await assert.rejects(command(db,{event,command:'updateDraft',revision:1,client:'connector',grant:uuid()}),/GRANT_REVOKED/);
  assert.equal(await count('tournament_operations',event),1);
});

test('published definitions are immutable and operation lookup checks current grants',async()=>{
  const event=await create(),definition=uuid();
  await command(db,{event,command:'updateDraft',revision:1,effects:{definition:{id:definition,definition:{schema_version:1},status:'draft'},event:{definition_id:definition}}});
  const op=uuid();
  await command(db,{event,operation:op,command:'publishTournament',revision:2,effects:{definition:{id:definition,definition:{schema_version:1},status:'published',canonical_hash:'c'.repeat(64)},event:{modular_state:'registration_open'}}});
  const receipt=await role(db,'service_role',owner,()=>db.query<{r:{revision:number}}>('SELECT tb_get_operation($1,$2,$3,NULL) r',[owner,'web',op]));
  assert.equal(Number(receipt.rows[0].r.revision),3);
  await assert.rejects(command(db,{event,command:'closeRegistration',revision:3,effects:{event:{modular_state:'registration_closed'},definition:{id:definition,definition:{tampered:true},status:'published'}}}),/PUBLISHED_DEFINITION/);
});

async function activeFixtures(){
 const event=uuid(),definition=uuid(),stage=uuid(),round=uuid(),a=uuid(),b=uuid(),c=uuid(),first=uuid(),second=uuid();
 await command(db,{event,effects:{definition:{id:definition,definition:{scheduling:{minimum_rest_minutes:15}},status:'draft'},event:{definition_id:definition,court_count:2}}});
 await command(db,{event,command:'publishTournament',revision:1,effects:{definition:{id:definition,definition:{scheduling:{minimum_rest_minutes:15}},status:'published'},event:{modular_state:'registration_open'}}});
 await command(db,{event,command:'closeRegistration',revision:2,effects:{event:{modular_state:'registration_closed'}}});
 await command(db,{event,command:'lockRoster',revision:3,effects:{event:{modular_state:'ready'},stages:[{id:stage,definition_id:definition,node_id:'round-robin',module_id:'round_robin',module_version:1,state:'active'}],teams:[{id:a,entry_state:'approved'},{id:b,entry_state:'approved'},{id:c,entry_state:'approved'}],team_members:[{id:uuid(),team_id:a,user_id:owner},{id:uuid(),team_id:b,user_id:player},{id:uuid(),team_id:c,user_id:stranger}],rounds:[{id:round,stage_id:stage,round_number:1,round_type:'round_robin',schedule_generation:1}],matches:[{id:first,round_id:round,stage_id:stage,logical_key:'first',schedule_generation:1,team_a_id:a,team_b_id:b},{id:second,round_id:round,stage_id:stage,logical_key:'second',schedule_generation:1,team_a_id:a,team_b_id:c}]}});
 await command(db,{event,command:'startTournament',revision:4,effects:{event:{modular_state:'active'}}});
 return {event,stage,round,a,b,c,first,second};
}

test('court/player occupancy and retry guards remain; recent completion never blocks another game',async()=>{
 const {event,first,second}=await activeFixtures();
 await command(db,{event,command:'startMatch',revision:5,request:{match_id:first},effects:{matches:[{id:first,status:'in_progress',court_number:1,started_at:new Date().toISOString()}]}});
 await assert.rejects(command(db,{event,command:'startMatch',revision:6,request:{match_id:first},effects:{matches:[{id:first,status:'in_progress',court_number:1}]}}),/INVALID_STATE/);
 await assert.rejects(command(db,{event,command:'startMatch',revision:6,request:{match_id:second},effects:{matches:[{id:second,status:'in_progress',court_number:1}]}}),/COURT_BUSY/);
 await assert.rejects(command(db,{event,command:'startMatch',revision:6,request:{match_id:second},effects:{matches:[{id:second,status:'in_progress',court_number:2}]}}),/PLAYER_BUSY/);
 await command(db,{event,command:'attestScore',revision:6,effects:{matches:[{id:first,status:'validated',outcome_kind:'played',ended_at:new Date().toISOString(),is_current:false,voided_at:new Date().toISOString()}]}});
 await command(db,{event,command:'startMatch',revision:7,request:{match_id:second},effects:{matches:[{id:second,status:'in_progress',court_number:2,started_at:new Date().toISOString()}]}});
 assert.equal(Number((await db.query<{revision:number}>('SELECT revision FROM tournaments WHERE id=$1',[event])).rows[0].revision),8);
});

test('logical fixture duplicates and cross-event round/team assignments roll back',async()=>{
 const f=await activeFixtures(),other=await activeFixtures();
 await assert.rejects(command(db,{event:f.event,command:'attestScore',revision:5,effects:{matches:[{id:uuid(),round_id:f.round,stage_id:f.stage,logical_key:'first',schedule_generation:1,team_a_id:f.a,team_b_id:f.b}]}}),/unique/);
 await assert.rejects(command(db,{event:f.event,command:'attestScore',revision:5,effects:{matches:[{id:f.first,round_id:other.round}]}}),/foreign key/);
 await assert.rejects(command(db,{event:f.event,command:'attestScore',revision:5,effects:{matches:[{id:f.first,team_b_id:other.a}]}}),/foreign key/);
 assert.equal(await count('matches',f.event),2);
});

test('operation preflight is authorized and checks stored command/resource/hash before replay',async()=>{
 const event=uuid(),operation=uuid();
 const preflight=()=>role(db,'service_role',owner,()=>db.query<{r:unknown}>('SELECT tb_get_operation($1,$2,$3,NULL,$4,$5,$6,$7) r',[owner,'web',operation,event,'createDraft','{}','a'.repeat(64)]));
 assert.equal((await preflight()).rows[0].r,null);
 await command(db,{event,operation});
 assert.notEqual((await preflight()).rows[0].r,null);
 await assert.rejects(role(db,'service_role',owner,()=>db.query('SELECT tb_get_operation($1,$2,$3,NULL,$4,$5,$6,$7)',[owner,'web',operation,event,'updateDraft','{}','a'.repeat(64)])),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(role(db,'service_role',owner,()=>db.query('SELECT tb_get_operation($1,$2,$3,NULL,$4,$5,$6,$7)',[owner,'web',operation,event,'createDraft','{}','b'.repeat(64)])),/IDEMPOTENCY_CONFLICT/);
});

test('published unlisted links are readable; pending entries and draft definitions stay scoped to own invitations',async()=>{
 const event=await create(),definition=uuid(),ownTeam=uuid(),privateTeam=uuid(),viewer=uuid();
 await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'viewer@example.invalid','{\"given_name\":\"Viewer\"}')",[viewer]);
 await command(db,{event,command:'updateDraft',revision:1,effects:{event:{definition_id:definition},definition:{id:definition,definition:{title:'Published'},status:'draft'}}});
 await command(db,{event,command:'publishTournament',revision:2,effects:{definition:{id:definition,definition:{title:'Published'},status:'published'},event:{modular_state:'registration_open',is_public:false}}});
 await command(db,{event,command:'requestEntry',actor:player,revision:3,effects:{teams:[{id:ownTeam,entry_state:'pending'},{id:privateTeam,entry_state:'pending'}],team_members:[{id:uuid(),team_id:ownTeam,user_id:player,membership_status:'pending'},{id:uuid(),team_id:ownTeam,user_id:stranger,membership_status:'pending'},{id:uuid(),team_id:privateTeam,user_id:viewer,membership_status:'pending'}]}});
 async function snap(actor:string){return role(db,'service_role',actor,async()=>{const r=await db.query<{r:{teams:{id:string}[];team_members:{id:string;user_id:string}[];definitions:{status:string}[];caller_role:string}}>('SELECT tb_get_snapshot($1,$2,$3,NULL) r',[actor,'web',event]);return r.rows[0].r;});}
 const invited=await snap(stranger);assert.deepEqual(invited.teams.map(t=>t.id),[ownTeam]);assert.equal(invited.team_members.length,2);assert.ok(invited.definitions.every(d=>d.status==='published'));assert.equal(invited.caller_role,'player');
 const ordinary=uuid();await db.query("INSERT INTO auth.users(id,email) VALUES($1,'ordinary@example.invalid')",[ordinary]);
 assert.deepEqual((await snap(ordinary)).teams,[]);
 const before=await create();await assert.rejects(role(db,'service_role',ordinary,()=>db.query('SELECT tb_get_snapshot($1,$2,$3,NULL)',[ordinary,'web',before])),/FORBIDDEN/);
 await command(db,{event,actor:stranger,command:'acceptPartner',revision:4,request:{entry_id:ownTeam},effects:{team_members:[{id:invited.team_members.find(m=>m.user_id===stranger)!.id,consented_at:new Date().toISOString()}]}});
});


test('F01 real SQL persists sixteen-player fixed doubles through 28 round-robin fixtures and three playoffs',async()=>{
 const { planCommand } = await import('../../lib/tournament-builder/commands');
 const { definitionHash } = await import('../../lib/tournament-builder/requests');
 const { readFileSync } = await import('node:fs');
 type Snapshot=import('../../lib/tournament-builder/commands').CommandSnapshot;
 type Actor=import('../../lib/tournament-builder/commands').CommandActor;
 const definition=JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.event.starts_at='2030-11-07T09:00:00-05:00';definition.event.expected_end_at='2030-11-07T12:30:00-05:00';definition.registration.closes_at='2030-11-06T18:00:00-05:00';definition.scheduling.minimum_rest_minutes=0;
 const event=uuid();let snapshot:Snapshot={event:null,definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[]};
 const host:Actor={id:owner,clientId:'web',role:'owner'};const players:Actor[][]=[];
 async function run(name:string,data:Record<string,unknown>={},actor=host){
  const plan=planCommand(snapshot,actor,name,data,{now:new Date().toISOString(),id:uuid,draw:ids=>[...ids].reverse()});
  await command(db,{event,actor:actor.id,command:name,revision:snapshot.event?Number(snapshot.event.revision):null,request:data,effects:plan.effects,result:plan.result});
  snapshot=await role(db,'service_role',owner,async()=>{const r=await db.query<{r:Snapshot}>('SELECT tb_get_snapshot($1,$2,$3,NULL) r',[owner,'web',event]);return r.rows[0].r;});
 }
 await run('createDraft',{definition});await run('publishTournament',{reviewed_definition_hash:definitionHash(definition),acknowledged_warning_codes:[]});
 for(let i=0;i<8;i++){
  const pair:Actor[]=[{id:uuid(),clientId:'web',role:'player'},{id:uuid(),clientId:'web',role:'player'}];players.push(pair);
  for(const actor of pair)await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[actor.id,actor.id+'@example.invalid']);
  const consent={consent:true,definition_id:snapshot.event!.definition_id};
  await run('requestEntry',{...consent,partner_id:pair[1].id,entry_name:String.fromCharCode(65+i)},pair[0]);
  const team=snapshot.teams.find(t=>t.name===String.fromCharCode(65+i))!;
  await run('acceptPartner',{...consent,entry_id:team.id},pair[1]);await run('approveEntry',{entry_id:team.id});
 }
 await run('closeRegistration');await run('lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});assert.equal(snapshot.matches.length,28);
 const initial=snapshot.matches.map(m=>m.id);await run('startTournament');let played=0;
 while(snapshot.event!.modular_state!=='completed'){
  assert.ok(played++<32,'Progression must terminate at supported fixture count.');
  const match=snapshot.matches.find(m=>m.status==='scheduled'&&m.team_a_id&&m.team_b_id);assert.ok(match);
  const a=snapshot.teams.find(t=>t.id===match.team_a_id)!,b=snapshot.teams.find(t=>t.id===match.team_b_id)!;
  await run('startMatch',{match_id:match.id});const aWins=String(a.name)<String(b.name);
  await run('submitScore',{match_id:match.id,score_a:aWins?11:5,score_b:aWins?5:11},players[String(a.name).charCodeAt(0)-65][0]);
  await run('confirmScore',{match_id:match.id,result_revision:snapshot.matches.find(m=>m.id===match.id)!.result_revision},players[String(b.name).charCodeAt(0)-65][0]);
 }
 assert.equal(snapshot.matches.length,31);assert.equal(snapshot.event!.result_version,1);assert.ok(initial.every(id=>snapshot.matches.some(m=>m.id===id)));
 const output=snapshot.stages.find(s=>s.module_id==='placements')!.output as {groups:{rank:number;entryIds:string[]}[]};assert.deepEqual(output.groups.map(g=>[g.rank,g.entryIds.length]),[[1,1],[2,1],[3,2],[5,1],[6,1],[7,1],[8,1]]);
});



test('own withdrawal is permitted before roster lock and remains admin-only after lock',async()=>{
 const event=await create(),definition=uuid(),team=uuid(),member=uuid();
 await command(db,{event,command:'publishTournament',revision:1,effects:{definition:{id:definition,definition:{},status:'published'},event:{definition_id:definition,modular_state:'registration_open'}}});
 await command(db,{event,actor:player,command:'requestEntry',revision:2,effects:{teams:[{id:team,entry_state:'pending'}],team_members:[{id:member,team_id:team,user_id:player,membership_status:'pending'}]}});
 await command(db,{event,actor:player,command:'withdrawEntry',revision:3,request:{entry_id:team,reason:'Own pre-lock cancellation'},effects:{teams:[{id:team,entry_state:'cancelled'}],team_members:[{id:member,membership_status:'cancelled'}]}});
 const active=await activeFixtures();
 await assert.rejects(command(db,{event:active.event,actor:player,command:'withdrawEntry',revision:5,request:{entry_id:active.b,reason:'After-lock participant bypass'},effects:{teams:[{id:active.b,entry_state:'withdrawn'}]}}),/FORBIDDEN/);
});

test('voiding a started match preserves history without imposing elapsed rest',async()=>{
 const f=await activeFixtures();
 await command(db,{event:f.event,command:'startMatch',revision:5,request:{match_id:f.first},effects:{matches:[{id:f.first,status:'in_progress',court_number:1,started_at:new Date().toISOString()}]}});
 await command(db,{event:f.event,command:'commitCorrection',revision:6,effects:{matches:[{id:f.first,is_current:false,voided_at:new Date().toISOString(),ended_at:new Date().toISOString(),outcome_kind:null}]}});
 await command(db,{event:f.event,command:'startMatch',revision:7,request:{match_id:f.second},effects:{matches:[{id:f.second,status:'in_progress',court_number:2,started_at:new Date().toISOString()}]}});
});

