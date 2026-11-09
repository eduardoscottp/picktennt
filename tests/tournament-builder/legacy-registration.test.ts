import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { storageDatabase, owner, player } from './helpers/storage-db';

test('legacy readers explicitly select the original relationship after modular adds another FK',async()=>{
 const db=await storageDatabase();
 try {
  const constraints=await db.query<{conname:string}>("SELECT conname FROM pg_constraint WHERE conrelid='team_members'::regclass AND confrelid='teams'::regclass AND contype='f'");
  assert.equal(constraints.rows.length,2);
  assert.ok(constraints.rows.some(row=>row.conname==='team_members_team_id_fkey'));
  for(const path of ['app/(app)/dashboard/page.tsx','app/(app)/tournaments/[id]/page.tsx','app/(app)/tournaments/[id]/admin/page.tsx','app/(app)/tournaments/[id]/matches/page.tsx','app/(app)/tournaments/[id]/leaderboard/page.tsx','components/tournament/admin-generate-round.tsx']) {
   const source=readFileSync(path,'utf8');assert.doesNotMatch(source,/team_members\(/);assert.match(source,/team_members!team_members_team_id_fkey\(/);
  }
  const event=crypto.randomUUID(),team=crypto.randomUUID();
  await db.query("INSERT INTO tournaments(id,name,created_by,court_count,max_players,type,status) VALUES($1,'Legacy slots',$2,2,8,'doubles','registration')",[event,owner]);
  await db.query("INSERT INTO teams(id,tournament_id,name) VALUES($1,$2,'Team 1')",[team,event]);
  await db.query("INSERT INTO tournament_players(tournament_id,user_id,status) VALUES($1,$2,'approved')",[event,player]);
  await db.query('INSERT INTO team_members(team_id,user_id) VALUES($1,$2)',[team,player]);
  const members=await db.query<{tournament_id:string;membership_status:string}>('SELECT tournament_id,membership_status FROM team_members WHERE team_id=$1',[team]);
  assert.equal(members.rows[0].tournament_id,event);assert.equal(members.rows[0].membership_status,'legacy');
  await db.query('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2',[team,player]);
  assert.equal((await db.query('SELECT id FROM teams WHERE id=$1',[team])).rows.length,1);
 } finally {await db.close();}
});
