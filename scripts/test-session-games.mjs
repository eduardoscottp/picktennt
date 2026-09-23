// Run with PGLITE_MODULE pointing at an installed @electric-sql/pglite module.
// Executes the actual migrations with distinct database roles; no production data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let checks=0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
const denied=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++};
const [admin,a,b,c,d,outsider]=Array.from({length:6},()=>randomUUID());
try {
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE profiles(id uuid PRIMARY KEY,first_name text,last_name text,avatar_url text,email text);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON profiles TO authenticated;
CREATE POLICY profiles_self_read ON profiles FOR SELECT TO authenticated USING (id=auth.uid());
CREATE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
for (const migration of ['011_play_sessions.sql','012_session_games.sql']) await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'));
for (const [i,id] of [admin,a,b,c,d,outsider].entries()) await db.query('INSERT INTO profiles(id,first_name,last_name) VALUES ($1,$2,$3)',[id,`Player${i}`,'Test']);
const actor=async(id)=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated')};
await actor(admin);
const sid=(await db.query(`SELECT play_session_create('Test session',now()+interval '1 day',90,'UTC',2,'Test Courts','Test address',8,'random_player','Database test',false) AS id`)).rows[0].id;
for(const id of [a,b,c,d]) {await actor(id);await db.query('SELECT play_session_join($1,NULL,NULL)',[sid])}
const mutate=async(op,g,data={},id=randomUUID())=>(await db.query('SELECT session_game_mutate($1,$2,$3,$4,$5) AS game',[op,g.id,g.revision??null,id,JSON.stringify(data)])).rows[0].game;
const createData={sessionId:sid,playerIds:[a,b,c,d],matchType:'DOUBLES',scoringSystem:'SIDE_OUT',targetScore:11,winByTwo:true,courtNumber:1,scorerId:c};
await actor(outsider);
await denied(()=>mutate('create',{id:randomUUID()},createData),/must play/);
await actor(a);
await denied(()=>mutate('create',{id:randomUUID()},{...createData,health:{heartRate:120}}),/Private health/);
await denied(()=>mutate('create',{id:randomUUID()},{...createData,playerIds:[a,a,c,d]}),/distinct/);
await denied(()=>mutate('create',{id:randomUUID()},{...createData,scorerId:outsider}),/scorer/);
await denied(()=>mutate('create',{id:randomUUID()},{...createData,courtNumber:3}),/court/);
const createID=randomUUID(),opID=randomUUID();
let game=await mutate('create',{id:createID},createData,opID);check(game.status,'invited');
check((await mutate('create',{id:createID},createData,opID)).id,createID);
await denied(()=>mutate('create',{id:createID},{...createData,targetScore:15},opID),/already used/);
await denied(()=>mutate('accept',game),/invitation/);
await denied(()=>db.query("UPDATE play_session_games SET status='confirmed' WHERE id=$1",[game.id]),/permission denied/);
await actor(c); game=await mutate('decline',game);check(game.status,'unassigned');
await actor(a); game=await mutate('assign',game,{scorerId:d});
await actor(c);await denied(()=>mutate('accept',game),/invitation/);
await actor(d); game=await mutate('accept',game);check(game.status,'ready');
await actor(a);await denied(()=>mutate('assign',game,{scorerId:a}),/reassign/);await actor(d);
game=await mutate('start',game);check(game.status,'in_progress');
await actor(admin);await denied(()=>mutate('assign',game,{scorerId:a}),/reassign/);
await actor(a);await denied(()=>mutate('submit',game,{source:'manual',scoreA:11,scoreB:4}),/Watch is scoring/);
await actor(d);await denied(()=>mutate('submit',game,{source:'watch',assignmentRevision:0,scoreA:4,scoreB:11}),/assignment/);
await denied(()=>mutate('submit',game,{source:'watch',assignmentRevision:game.assignment_revision,scoreA:10,scoreB:11}),/final score/);
const prepared=game,submitID=randomUUID(),result={source:'watch',assignmentRevision:game.assignment_revision,scoreA:4,scoreB:11};
game=await mutate('submit',game,result,submitID);check(game.status,'pending');
check((await mutate('submit',prepared,result,submitID)).revision,game.revision);
await denied(()=>mutate('confirm',game),/opponent/);
await actor(c);await denied(()=>mutate('confirm',game),/opponent/);
await actor(a);game=await mutate('dispute',game);check(game.status,'disputed');
await actor(b);await denied(()=>mutate('confirm',game),/opponent/);
await actor(admin);game=await mutate('submit',game,{source:'manual',scoreA:5,scoreB:11});
await actor(a);await denied(()=>mutate('confirm',game),/opponent/);
await actor(admin);game=await mutate('confirm',game);check(game.status,'confirmed');
for(const id of [a,b,c,d]) {await actor(id);check((await db.query("SELECT count(*)::int AS n FROM play_session_games WHERE status='confirmed'")).rows[0].n,1)}
await actor(outsider);check((await db.query('SELECT count(*)::int AS n FROM play_session_games')).rows[0].n,0);
check((await db.query('SELECT count(*)::int AS n FROM play_session_game_operations')).rows[0].n,0);
await actor(admin);await db.query('SELECT play_session_remove_member($1,$2)',[sid,d]);
await actor(d);check((await db.query('SELECT participants FROM play_session_games WHERE id=$1',[game.id])).rows[0].participants.length,4);
await actor(a);await denied(()=>mutate('create',{id:randomUUID()},createData),/roster changed/);
await actor(admin);await db.query('SELECT play_session_allow_rejoin($1,$2)',[sid,d]);await actor(d);await db.query('SELECT play_session_join($1,NULL,NULL)',[sid]);
await actor(a);let manual=await mutate('create',{id:randomUUID()},{...createData,scorerId:null});
manual=await mutate('submit',manual,{source:'manual',scoreA:11,scoreB:7});
await actor(c);manual=await mutate('confirm',manual);check(manual.status,'confirmed');
await actor(a);await denied(()=>mutate('submit',manual,{source:'manual',scoreA:11,scoreB:8}),/organizer/);
await actor(admin);const old=manual;manual=await mutate('submit',manual,{source:'manual',scoreA:11,scoreB:8});check(manual.status,'pending');
await denied(()=>mutate('confirm',old),/changed/);
manual=await mutate('cancel',manual);check(manual.status,'cancelled');
await denied(()=>mutate('confirm',manual),/cancelled/);
await actor(a);let unfinished=await mutate('create',{id:randomUUID()},createData);await actor(c);unfinished=await mutate('accept',unfinished);unfinished=await mutate('start',unfinished);unfinished=await mutate('submit',unfinished,{source:'watch',assignmentRevision:unfinished.assignment_revision,scoreA:2,scoreB:1,unfinished:true});check(unfinished.status,'unfinished');
await denied(()=>mutate('confirm',unfinished),/opponent/);
await actor(a);let singles=await mutate('create',{id:randomUUID()},{...createData,playerIds:[a,b],matchType:'SINGLES',winByTwo:false,scorerId:null});
singles=await mutate('submit',singles,{source:'manual',scoreA:11,scoreB:10});await actor(b);singles=await mutate('confirm',singles);check(singles.status,'confirmed');
// Border cases: consent races, departed roster, score boundaries and independent courts.
await actor(a);
await denied(()=>mutate('create',{id:randomUUID()},{...createData,playerIds:[b,c,d,outsider]}),/must play/);
let waiting=await mutate('create',{id:randomUUID()},createData);
await actor(admin);await db.query('SELECT play_session_remove_member($1,$2)',[sid,b]);
await actor(c);await denied(()=>mutate('accept',waiting),/no longer active/);
await actor(admin);await db.query('SELECT play_session_allow_rejoin($1,$2)',[sid,b]);
await actor(b);await db.query('SELECT play_session_join($1,NULL,NULL)',[sid]);
await actor(a);waiting=await mutate('cancel',waiting);check(waiting.status,'cancelled');
await actor(c);await denied(()=>mutate('accept',waiting),/cancelled/);
await actor(a);
for(const [sa,sb] of [[-1,11],[11,11],[10,8],[11,10],[14,10],[10001,0]]) {
 const g=await mutate('create',{id:randomUUID()},{...createData,scorerId:null});
 await denied(()=>mutate('submit',g,{source:'manual',scoreA:sa,scoreB:sb}),/score/);
}
for(const [sa,sb] of [[11,0],[0,11],[12,10],[14,12]]) {
 let g=await mutate('create',{id:randomUUID()},{...createData,scorerId:null});
 g=await mutate('submit',g,{source:'manual',scoreA:sa,scoreB:sb});check(g.status,'pending');
}
let reserved=await mutate('create',{id:randomUUID()},createData);
await actor(c);reserved=await mutate('accept',reserved);const beforePrepare=reserved;
reserved=await mutate('start',reserved);
await denied(()=>mutate('start',beforePrepare),/changed/);
await actor(admin);reserved=await mutate('cancel',reserved);
await actor(c);await denied(()=>mutate('submit',reserved,{source:'watch',scoreA:11,scoreB:0,assignmentRevision:1}),/cancelled/);
await actor(outsider);await denied(()=>mutate('confirm',manual),/cannot change/);
await denied(()=>mutate('create',{id:createID},createData,opID),/already used/);
// Games do not reserve courts, and finals can be entered after the session ends.
await db.exec('RESET ROLE');await db.query("UPDATE play_sessions SET starts_at=now()-interval '2 days' WHERE id=$1",[sid]);
await actor(a);let late=await mutate('create',{id:randomUUID()},{...createData,scorerId:null});
late=await mutate('submit',late,{source:'manual',scoreA:11,scoreB:9});check(late.status,'pending');
await actor(c);late=await mutate('confirm',late);check(late.status,'confirmed');
// Roster names remain available with production-style private profile RLS.
await actor(a);
check((await db.query('SELECT count(*)::int n FROM profiles')).rows[0].n,1);
const detail=(await db.query('SELECT play_session_detail($1) AS detail',[sid])).rows[0].detail;
check(detail.members.length,4);
check(detail.members.every(m=>Object.keys(m.profile).sort().join(',')==='avatar_url,first_name,id,last_name'),true);
check(detail.members.every(m=>m.profile.first_name.startsWith('Player')),true);
await actor(outsider);await denied(()=>db.query('SELECT play_session_detail($1)',[sid]),/SESSION_NOT_FOUND/);
// Session boundary regressions using the same migrations as production.
await actor(admin);
const paired=(await db.query(`SELECT play_session_create('Partner boundary',now()+interval '1 day',90,'UTC',1,'Courts','Address',4,'by_partner','',false) AS id`)).rows[0].id;
const pairs=(await db.query('SELECT id FROM play_session_pairs WHERE session_id=$1 ORDER BY pair_number',[paired])).rows;
const seat=async(user,pair,number)=>{await actor(user);return db.query('SELECT play_session_join($1,$2,$3)',[paired,pairs[pair].id,number])};
await seat(a,0,1);
await actor(b);await denied(()=>db.query('SELECT play_session_join($1,$2,1)',[paired,pairs[0].id]),/SEAT_TAKEN/);
await seat(b,0,2);await seat(c,1,1);await seat(d,1,2);
await actor(outsider);await denied(()=>db.query('SELECT play_session_join($1,$2,1)',[paired,pairs[0].id]),/SESSION_FULL/);
await actor(a);
const before=(await db.query('SELECT user_id,pair_id,seat_number FROM play_session_members WHERE session_id=$1 ORDER BY user_id',[paired])).rows;
const changedPartners=await mutate('create',{id:randomUUID()},{...createData,sessionId:paired,playerIds:[a,c,b,d]});
check(changedPartners.participants.filter(p=>p.team===0).map(p=>p.userId),[a,c]);
check((await db.query('SELECT user_id,pair_id,seat_number FROM play_session_members WHERE session_id=$1 ORDER BY user_id',[paired])).rows,before);
await db.query('SELECT play_session_join($1,$2,1)',[paired,pairs[0].id]);
check((await db.query("SELECT count(*)::int n FROM play_session_members WHERE session_id=$1 AND state='active'",[paired])).rows[0].n,4);
await denied(()=>db.query('SELECT play_session_remove_member($1,$2)',[paired,b]),/NOT_SESSION_ADMIN/);
await actor(admin);await db.query('SELECT play_session_remove_member($1,$2)',[paired,b]);
await actor(b);await denied(()=>db.query('SELECT play_session_join($1,$2,2)',[paired,pairs[0].id]),/REJOIN_BLOCKED/);
await seat(outsider,0,2);
await actor(a);await denied(()=>db.query('SELECT play_session_switch_seat($1,$2,2)',[paired,pairs[0].id]),/SEAT_TAKEN/);
await actor(admin);await db.query('SELECT play_session_cancel($1)',[paired]);
await actor(c);await denied(()=>mutate('accept',changedPartners),/cancelled/i);
await db.exec('RESET ROLE; SET ROLE anon');await denied(()=>db.query('SELECT * FROM play_session_games'),/permission denied/);
console.log(`PASS: ${checks} session-game migration, lifecycle, idempotency and permission checks across four players, organizer and outsider.`);
} catch(error) { console.error(error.message);process.exitCode=1 } finally { await db.close() }
