// Local-only simulator harness: actual migrations and RPCs, isolated PostgreSQL/WASM.
// Never forwards tokens or data to production. Requires PGLITE_MODULE.
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const admin='4a87e526-9a6e-407d-8d82-f7a0af468e5e',player='7ad586e1-5d8b-4d6f-bb4d-160fc054ea2a',partner='b612ae57-7f1c-4d28-b2e2-a8a3dd909070',fourth='11111111-2222-3333-4444-555555555555';
const sid='c231771c-96bb-46f0-95cc-bbe4564ec437';
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE profiles(id uuid PRIMARY KEY,first_name text,last_name text,avatar_url text);
CREATE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
await db.exec('GRANT SELECT ON profiles TO authenticated');
for(const f of ['011_play_sessions.sql','012_session_games.sql']) await db.exec(readFileSync(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
for(const [id,name] of [[admin,'Organizer'],[player,'Demo Player'],[partner,'Partner'],[fourth,'Opponent']]) await db.query('INSERT INTO profiles VALUES ($1,$2,NULL,NULL)',[id,name]);
await db.query(`INSERT INTO play_sessions(id,created_by,title,starts_at,duration_minutes,timezone,court_count,location_name,location_address,max_players,format) VALUES ($1,$2,'Community Open Play',now()+interval '1 day',90,'UTC',2,'Test Courts','1 Test Way',8,'random_player')`,[sid,admin]);
for(const id of [admin,player,partner,fourth]) await db.query('INSERT INTO play_session_members(session_id,user_id) VALUES ($1,$2)',[sid,id]);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[admin]);
await db.query('SELECT session_game_mutate($1,$2,NULL,$3,$4)',['create','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',JSON.stringify({sessionId:sid,playerIds:[player,partner,admin,fourth],matchType:'DOUBLES',scoringSystem:'SIDE_OUT',targetScore:11,winByTwo:true,scorerId:player})]);
let queue=Promise.resolve();
createServer(async(req,res)=>{
 let bytes='';for await(const part of req) bytes+=part;
 queue=queue.then(async()=>{
 try {
 const token=req.headers.authorization?.replace('Bearer picktennt-app-store-demo:','').toLowerCase();
 if(![admin,player,partner,fourth].includes(token)) {res.writeHead(401);res.end('{}');return}
 await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[token]);await db.exec('SET ROLE authenticated');
 let value;
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET' && req.url.startsWith('/play_session_games?')) value=(await db.query('SELECT * FROM play_session_games ORDER BY created_at DESC')).rows;
 else if(req.method==='POST' && req.url==='/rpc/session_game_mutate') {const c=JSON.parse(bytes);value=(await db.query('SELECT session_game_mutate($1,$2,$3,$4,$5) AS game',[c.p_operation,c.p_game_id,c.p_revision,c.p_operation_id,JSON.stringify(c.p_data)])).rows[0].game}
 else if(req.method==='GET' && ['/play_sessions','/play_session_members','/play_session_pairs'].includes(url.pathname)) {
   const table=url.pathname.slice(1), column=table==='play_sessions'?'id':'session_id';
   const filter=url.searchParams.get(column)?.replace(/^eq\./,'');
   const selection=table==='play_session_members'?'t.*,row_to_json(p) AS profile':'t.*';
   const join=table==='play_session_members'?' LEFT JOIN profiles p ON p.id=t.user_id':'';
   value=(await db.query(`SELECT ${selection} FROM ${table} t${join}${filter?` WHERE t.${column}=$1`:''}`,filter?[filter]:[])).rows;
 } else if(req.method==='POST' && url.pathname.startsWith('/rpc/play_session_')) {
   const name=url.pathname.slice(5);
   const allowed=['play_session_create','play_session_update','play_session_join','play_session_switch_seat','play_session_leave','play_session_cancel','play_session_set_closed','play_session_remove_member','play_session_allow_rejoin','play_session_invitation_detail','play_session_detail'];
   if(!allowed.includes(name)) throw Error('Unknown local test operation');
   const body=JSON.parse(bytes),keys=Object.keys(body);
   if(keys.some(k=>!/^p_[a-z_]+$/.test(k))) throw Error('Invalid arguments');
   value=(await db.query(`SELECT ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) AS result`,keys.map(k=>body[k]))).rows[0].result;
 } else {res.writeHead(404);res.end('{}');return}
 console.log(req.method,url.pathname,token,value?.status || 'OK');
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
 } catch(e) {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}))}
 });
}).listen(8765,'127.0.0.1',()=>console.log('Isolated session-game simulator backend: http://127.0.0.1:8765'));
