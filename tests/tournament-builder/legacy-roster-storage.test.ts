import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { storageDatabase, role, owner, player, stranger, command } from './helpers/storage-db';

test('legacy assignments are atomic, scoped, capacity checked and preserve actual played lineups', async () => {
  const db = await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202611090002_legacy_roster_management.sql','utf8'));
    const extra = randomUUID(), extra2 = randomUUID();
    for (const id of [extra,extra2]) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,id+'@test.invalid']);
    const event=randomUUID(), a=randomUUID(), b=randomUUID(), round=randomUUID(), played=randomUUID(), pending=randomUUID();
    await db.query("INSERT INTO tournaments(id,name,created_by,court_count,max_players,type,status) VALUES($1,'Legacy replacement',$2,1,4,'doubles','registration')",[event,owner]);
    await db.query('INSERT INTO teams(id,tournament_id,name) VALUES($1,$3,$4),($2,$3,$5)',[a,b,event,'A','B']);
    await db.query("INSERT INTO tournament_players(tournament_id,user_id,status) VALUES($1,$2,'approved')",[event,player]);
    const set = (who: string, team: string, user: string, old: string|null=null, ev=event) => role(db,'authenticated',who,()=>db.query('SELECT legacy_set_team_player($1,$2,$3,$4)',[ev,team,user,old]));
    await assert.rejects(set(stranger,a,stranger),/FORBIDDEN/);
    await set(player,a,player);
    await assert.rejects(set(player,b,stranger),/FORBIDDEN/);
    await assert.rejects(set(player,b,player),/DUPLICATE_ENTRY/);
    await set(owner,a,owner);
    await assert.rejects(set(owner,a,stranger),/SLOT_FULL/);
    assert.equal((await db.query('SELECT id FROM tournament_players WHERE tournament_id=$1 AND user_id=$2',[event,stranger])).rows.length,0);
    await set(owner,b,stranger); await set(owner,b,extra);
    const fullSlot=randomUUID(), otherEvent=randomUUID(), otherTeam=randomUUID();
    await db.query('INSERT INTO teams(id,tournament_id) VALUES($1,$2)',[fullSlot,event]);
    await assert.rejects(set(owner,fullSlot,extra2),/CAPACITY_FULL/);
    await assert.rejects(set(owner,fullSlot,randomUUID()),/ACCOUNT_REQUIRED/);
    await db.query("INSERT INTO tournaments(id,name,created_by,court_count,max_players,type,status) VALUES($1,'Other',$2,1,4,'doubles','registration')",[otherEvent,owner]);
    await db.query('INSERT INTO teams(id,tournament_id) VALUES($1,$2)',[otherTeam,otherEvent]);
    await assert.rejects(set(owner,otherTeam,extra2),/NOT_FOUND/);
    await db.query("INSERT INTO rounds(id,tournament_id,round_number,round_type) VALUES($1,$2,1,'round_robin')",[round,event]);
    await db.query('INSERT INTO matches(id,tournament_id,round_id,team_a_id,team_b_id) VALUES($1,$3,$4,$5,$6),($2,$3,$4,$5,$6)',[played,pending,event,round,a,b]);
    await db.query("UPDATE tournaments SET status='active' WHERE id=$1",[event]);
    await assert.rejects(set(player,b,extra2),/FORBIDDEN/);
    await db.query("UPDATE matches SET status='in_progress' WHERE id=$1",[played]);
    await assert.rejects(set(owner,a,extra2,player),/MATCH_IN_PROGRESS/);
    await db.query("UPDATE matches SET status='validated',score_a=11,score_b=5 WHERE id=$1",[played]);
    const before=(await db.query<Record<string, unknown>>('SELECT * FROM matches WHERE id=$1',[played])).rows[0];
    assert.ok([before.player_a1_id,before.player_a2_id].includes(player));
    await db.query("UPDATE tournament_players SET exit_reason='retired',nullified_from_standings=true WHERE tournament_id=$1 AND user_id=$2",[event,player]);
    await assert.rejects(set(owner,a,extra2,player),/ROSTER_WITHDRAWN/);
    await db.query('UPDATE tournament_players SET exit_reason=NULL,nullified_from_standings=false WHERE tournament_id=$1 AND user_id=$2',[event,player]);
    await db.query('INSERT INTO tournament_admins(tournament_id,user_id,succession_order,granted_by) VALUES($1,$2,2,$3)',[event,extra2,owner]);
    await set(extra2,a,extra2,player);
    await db.query('DELETE FROM tournament_admins WHERE tournament_id=$1 AND user_id=$2',[event,extra2]);
    await assert.rejects(set(extra2,a,player,extra2),/FORBIDDEN/);
    assert.deepEqual((await db.query('SELECT * FROM matches WHERE id=$1',[played])).rows[0],before);
    const future=(await db.query<Record<string, unknown>>('SELECT * FROM matches WHERE id=$1',[pending])).rows[0];
    assert.ok([future.player_a1_id,future.player_a2_id].includes(extra2));
    assert.ok(![future.player_a1_id,future.player_a2_id].includes(player));
    assert.equal((await db.query<{status: string}>('SELECT status FROM tournament_players WHERE tournament_id=$1 AND user_id=$2',[event,player])).rows[0].status,'rejected');
    await assert.rejects(set(owner,a,player,stranger),/STALE_ROSTER/);
    const modular=randomUUID(); await command(db,{event:modular});
    await assert.rejects(set(owner,a,player,null,modular),/NOT_FOUND/);
    await assert.rejects(role(db,'anon','',()=>db.query('SELECT legacy_set_team_player($1,$2,$3,NULL)',[event,a,player])),/permission denied/);

    // Existing historical rows without lineup evidence cannot be attributed to today's players.
    await db.query('UPDATE matches SET player_a1_id=NULL,player_a2_id=NULL WHERE id=$1',[played]);
    await assert.rejects(set(owner,a,player,extra2),/AMBIGUOUS_HISTORY/);
    assert.ok((await db.query<{user_id: string}>('SELECT user_id FROM team_members WHERE team_id=$1',[a])).rows.some(x=>x.user_id===extra2));
    await db.query("UPDATE tournaments SET status='completed' WHERE id=$1",[event]);
    await assert.rejects(set(owner,a,player,extra2),/INVALID_STATE/);
  } finally { await db.close(); }
});

test('legacy RPC rolls back assignment if enrollment fails and serializes competing final-slot requests', async () => {
  const db=await storageDatabase();
  try {
    await db.exec(readFileSync('supabase/migrations/202611090002_legacy_roster_management.sql','utf8'));
    const event=randomUUID(),team=randomUUID();
    await db.query("INSERT INTO tournaments(id,name,created_by,court_count,max_players,type,status) VALUES($1,'Atomic slots',$2,1,2,'singles','registration')",[event,owner]);
    await db.query('INSERT INTO teams(id,tournament_id) VALUES($1,$2)',[team,event]);
    await db.exec("ALTER TABLE tournament_players ADD CONSTRAINT test_reject_invite CHECK(joined_via IS DISTINCT FROM 'invite')");
    const set=(user:string)=>role(db,'authenticated',owner,()=>db.query('SELECT legacy_set_team_player($1,$2,$3,NULL)',[event,team,user]));
    await assert.rejects(set(player),/test_reject_invite/);
    assert.equal((await db.query('SELECT id FROM team_members WHERE team_id=$1',[team])).rows.length,0);
    await db.exec('ALTER TABLE tournament_players DROP CONSTRAINT test_reject_invite');
    // PGlite runs queued transactions serially: both requests still recheck capacity in SQL.
    const outcomes=await role(db,'authenticated',owner,()=>Promise.allSettled([player,stranger].map(user=>db.query('SELECT legacy_set_team_player($1,$2,$3,NULL)',[event,team,user]))));
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await db.query('SELECT id FROM team_members WHERE team_id=$1',[team])).rows.length,1);
    const source=readFileSync('supabase/migrations/202611090002_legacy_roster_management.sql','utf8');
    assert.match(source,/WHERE id=p_tournament_id FOR UPDATE/);
    assert.match(source,/ORDER BY id FOR UPDATE/);
  } finally { await db.close(); }
});
