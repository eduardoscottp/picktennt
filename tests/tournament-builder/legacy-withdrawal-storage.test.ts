import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { storageDatabase, role, owner, player, stranger, command } from './helpers/storage-db';

async function fixture(type = 'singles') {
  const db = await storageDatabase();
  for (const name of ['202611090002_legacy_roster_management.sql','202611090003_legacy_withdrawal_results.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8'));
  }
  await db.exec('ALTER TABLE matches ENABLE ROW LEVEL SECURITY');
  const initial=readFileSync('supabase/migrations/001_initial_schema.sql','utf8');
  await db.exec(initial.slice(initial.indexOf('CREATE POLICY "matches_read"'),initial.indexOf('CREATE POLICY "standings_read"')));
  const event=randomUUID(), rr=randomUUID(), elimination=randomUUID(), extra=randomUUID();
  const users=[owner,player,stranger,extra], teams=users.map(()=>randomUUID()), entries=users.map(()=>randomUUID());
  await db.query<Record<string,unknown>>('INSERT INTO auth.users(id,email) VALUES($1,$2)',[extra,extra+'@test.invalid']);
  await db.query<Record<string,unknown>>("INSERT INTO tournaments(id,name,created_by,court_count,max_players,type,status) VALUES($1,'Withdrawal',$2,1,4,$3,'active')",[event,owner,type]);
  for(let i=0;i<users.length;i++) {
    await db.query<Record<string,unknown>>("INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES($1,$2,$3,'approved')",[entries[i],event,users[i]]);
    await db.query<Record<string,unknown>>('INSERT INTO teams(id,tournament_id) VALUES($1,$2)',[teams[i],event]);
    await db.query<Record<string,unknown>>('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)',[teams[i],users[i]]);
  }
  await db.query<Record<string,unknown>>("INSERT INTO rounds(id,tournament_id,round_number,round_type) VALUES($1,$3,1,'round_robin'),($2,$3,2,'elimination')",[rr,elimination,event]);
  const match=async(a:number|null,b:number|null,round=rr) => {
    const id=randomUUID();
    await db.query<Record<string,unknown>>('INSERT INTO matches(id,tournament_id,round_id,team_a_id,team_b_id,player_a1_id,player_b1_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,event,round,type==='mixed'||a===null?null:teams[a],type==='mixed'||b===null?null:teams[b],a===null?null:users[a],b===null?null:users[b]]);
    return id;
  };
  const forfeit=(team:string,actor=owner,ev=event)=>role(db,'authenticated',actor,()=>db.query<Record<string,unknown>>('SELECT legacy_forfeit_team($1,$2) AS affected',[ev,team]));
  const row=async(id:string)=>(await db.query<Record<string,unknown>>('SELECT * FROM matches WHERE id=$1',[id])).rows[0];
  return {db,event,rr,elimination,teams,entries,users,match,forfeit,row};
}

test('team forfeit atomically rewrites past, live and future games 0–11, excludes DUPR and retains private recovery audit',async()=>{
  const f=await fixture(); const {db}=f;
  try {
    const played=await f.match(0,1), pending=await f.match(2,0), live=await f.match(0,2), unrelated=await f.match(1,2), archived=await f.match(0,1);
    await db.query<Record<string,unknown>>('UPDATE matches SET is_current=false WHERE id=$1',[archived]);
    const archivedBefore=await f.row(archived);
    await db.query<Record<string,unknown>>("UPDATE matches SET status='validated',score_a=11,score_b=7 WHERE id=$1",[played]);
    await db.query<Record<string,unknown>>("UPDATE matches SET status='in_progress',score_a=9,score_b=6 WHERE id=$1",[live]);
    const oldPlayed=(await db.query<Record<string,unknown>>('SELECT to_jsonb(m) AS row FROM matches m WHERE id=$1',[played])).rows[0].row as Record<string,unknown>, untouched=await f.row(unrelated);
    const result=await f.forfeit(f.teams[0]);
    assert.equal(result.rows[0].affected,3);
    for(const id of [played,pending,live]) {
      const m=await f.row(id), sideA=m.team_a_id===f.teams[0];
      assert.equal(m.status,'walkover'); assert.equal(m.outcome_kind,'walkover');
      assert.equal(m.score_a,sideA?0:11); assert.equal(m.score_b,sideA?11:0);
      assert.equal(m.legacy_winner_side,sideA?'b':'a'); assert.equal(m.winner_team_id,sideA?m.team_b_id:m.team_a_id);
      assert.equal(m.submit_to_dupr,false);
    }
    assert.deepEqual(await f.row(unrelated),untouched);
    assert.deepEqual(await f.row(archived),archivedBefore);
    const entry=(await db.query<Record<string,unknown>>('SELECT * FROM tournament_players WHERE id=$1',[f.entries[0]])).rows[0];
    assert.equal(entry.status,'rejected'); assert.equal(entry.exit_reason,'withdrew'); assert.equal(entry.nullified_from_standings,false);
    const audits=await role(db,'authenticated',owner,()=>db.query<Record<string,unknown>>('SELECT * FROM legacy_team_forfeit_audit'));
    assert.equal(audits.rows.length,1);
    const auditedMatch=(audits.rows[0].previous_matches as typeof oldPlayed[]).find(m=>m.id===played);
    assert.deepEqual(auditedMatch,oldPlayed);
    assert.equal((await role(db,'authenticated',stranger,()=>db.query<Record<string,unknown>>('SELECT * FROM legacy_team_forfeit_audit'))).rows.length,0);
    await assert.rejects(role(db,'authenticated',owner,()=>db.query<Record<string,unknown>>("UPDATE legacy_team_forfeit_audit SET previous_matches='[]'")),/permission denied/);
    await assert.rejects(f.forfeit(f.teams[0]),/TEAM_WITHDRAWN/);
    const awarded=await f.row(played);
    await assert.rejects(f.forfeit(f.teams[1]),/OPPONENT_WITHDRAWN/);
    assert.deepEqual(await f.row(played),awarded);
  } finally {await db.close();}
});

test('team forfeit rejects unauthorized, modular, mixed, foreign and incomplete opponents without partial changes',async()=>{
  const f=await fixture(); const {db}=f;
  try {
    const m=await f.match(0,null);
    await assert.rejects(f.forfeit(f.teams[0],player),/FORBIDDEN/);
    await assert.rejects(f.forfeit(f.teams[0]),/INCOMPLETE_OPPONENT/);
    assert.equal((await f.row(m)).status,'scheduled');
    assert.equal((await db.query<Record<string,unknown>>('SELECT legacy_withdrawn_at FROM teams WHERE id=$1',[f.teams[0]])).rows[0].legacy_withdrawn_at,null);
    assert.equal((await db.query<Record<string,unknown>>('SELECT * FROM legacy_team_forfeit_audit')).rows.length,0);
    await assert.rejects(role(db,'anon','',()=>db.query<Record<string,unknown>>('SELECT legacy_forfeit_team($1,$2)',[f.event,f.teams[0]])),/permission denied/);
    const modular=randomUUID(); await command(db,{event:modular});
    await assert.rejects(f.forfeit(f.teams[0],owner,modular),/NOT_FOUND/);
    await assert.rejects(f.forfeit(randomUUID()),/NOT_FOUND/);
    await db.query<Record<string,unknown>>("UPDATE tournaments SET type='mixed' WHERE id=$1",[f.event]);
    await assert.rejects(f.forfeit(f.teams[0]),/INVALID_STATE/);
  } finally {await db.close();}
});

test('admin validation works under real legacy RLS, propagates bracket, and protects resolved descendants from forfeit',async()=>{
  const f=await fixture(); const {db}=f;
  try {
    const source=await f.match(0,1,f.elimination), final=await f.match(null,2,f.elimination);
    await db.query<Record<string,unknown>>("UPDATE matches SET status='score_entered',score_a=11,score_b=6,bracket_next_winner_match_id=$2,bracket_winner_fills_side='a' WHERE id=$1",[source,final]);
    await assert.rejects(role(db,'authenticated',owner,()=>db.query<Record<string,unknown>>("UPDATE matches SET status='validated' WHERE id=$1",[source])),/row-level security/);
    await assert.rejects(role(db,'authenticated',player,()=>db.query<Record<string,unknown>>('SELECT legacy_record_admin_score($1)',[source])),/FORBIDDEN/);
    await assert.rejects(role(db,'authenticated',player,()=>db.query<Record<string,unknown>>("UPDATE matches SET legacy_winner_side='b' WHERE id=$1",[source])),/FORBIDDEN/);
    await role(db,'authenticated',owner,()=>db.query<Record<string,unknown>>('SELECT legacy_record_admin_score($1)',[source]));
    assert.equal((await f.row(source)).status,'validated'); assert.equal((await f.row(final)).team_a_id,f.teams[0]);
    const assignedBefore=await f.row(final), sourceBefore=await f.row(source);
    await assert.rejects(f.forfeit(f.teams[0]),/BRACKET_REVIEW_REQUIRED/);
    assert.deepEqual(await f.row(final),assignedBefore); assert.deepEqual(await f.row(source),sourceBefore);
    assert.equal((await db.query<Record<string,unknown>>('SELECT * FROM legacy_team_forfeit_audit')).rows.length,0);
    await role(db,'authenticated',owner,()=>db.query<Record<string,unknown>>('SELECT legacy_record_admin_score($1,11,5)',[final]));
    const before=await f.row(source), finalBefore=await f.row(final);
    await assert.rejects(f.forfeit(f.teams[0]),/PLAYED_DESCENDANT/);
    assert.deepEqual(await f.row(source),before); assert.deepEqual(await f.row(final),finalBefore);
    assert.equal((await db.query<Record<string,unknown>>('SELECT * FROM legacy_team_forfeit_audit')).rows.length,0);
    assert.equal((await db.query<Record<string,unknown>>('SELECT status FROM tournament_players WHERE id=$1',[f.entries[0]])).rows[0].status,'approved');
  } finally {await db.close();}
});

test('new forfeit fills empty future bracket positions while preserving unrelated matches',async()=>{
  const f=await fixture(); const {db}=f;
  try {
    const source=await f.match(0,1,f.elimination), final=await f.match(null,2,f.elimination);
    await db.query<Record<string,unknown>>("UPDATE matches SET bracket_next_winner_match_id=$2,bracket_winner_fills_side='a' WHERE id=$1",[source,final]);
    await f.forfeit(f.teams[0]);
    assert.equal((await f.row(final)).team_a_id,f.teams[1]);
    assert.equal((await f.row(final)).status,'scheduled');
    assert.equal((await f.row(final)).score_a,null);
  } finally {await db.close();}
});

test('completed doubles forfeit withdraws both partners and preserves membership identities',async()=>{
  const f=await fixture('doubles'); const {db}=f;
  try {
    await db.query<Record<string,unknown>>('UPDATE team_members SET team_id=$2 WHERE user_id=$1',[f.users[3],f.teams[0]]);
    await db.query<Record<string,unknown>>('UPDATE team_members SET team_id=$2 WHERE user_id=$1',[f.users[2],f.teams[1]]);
    const match=await f.match(0,1);
    await db.query<Record<string,unknown>>("UPDATE matches SET status='validated',score_a=11,score_b=9,player_a2_id=$2,player_b2_id=$3 WHERE id=$1",[match,f.users[3],f.users[2]]);
    await db.query<Record<string,unknown>>("UPDATE tournaments SET status='completed' WHERE id=$1",[f.event]);
    await f.forfeit(f.teams[0]);
    const partners=await db.query<Record<string,unknown>>('SELECT p.status,p.exit_reason,p.nullified_from_standings FROM tournament_players p JOIN team_members tm ON tm.user_id=p.user_id AND tm.tournament_id=p.tournament_id WHERE tm.team_id=$1',[f.teams[0]]);
    assert.equal(partners.rows.length,2);
    assert.ok(partners.rows.every(p=>p.status==='rejected' && p.exit_reason==='withdrew' && p.nullified_from_standings===false));
    const result=await f.row(match);
    assert.equal(result.score_a,0); assert.equal(result.score_b,11);
    assert.deepEqual(new Set([result.player_a1_id,result.player_a2_id]),new Set([f.users[0],f.users[3]]));
  } finally {await db.close();}
});
