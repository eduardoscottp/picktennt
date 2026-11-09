import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Match, Profile } from '../../types/database';
import { collectMatchUserIds, hasAmbiguousHistoricalRosters, hasCompleteMatchRosters, resolveMatchPlayers } from '../../lib/dupr/tournament-helpers';

test('modular DUPR excludes replaced players while preserving actual players who later withdrew', async () => {
  const members = [
    { team_id: 'a', user_id: 'replaced', membership_status: 'cancelled' },
    { team_id: 'a', user_id: 'actual-a', membership_status: 'active' },
    { team_id: 'b', user_id: 'actual-b', membership_status: 'withdrawn' },
  ];
  const db = { from(table: string) {
    assert.equal(table,'team_members');
    let rows=members;
    const query = {
      select() { return query; },
      in(key: keyof typeof members[number], values: string[]) { rows=rows.filter(row=>values.includes(row[key]));return query; },
      then(done: (value: {data: typeof members; error: null}) => unknown) { return Promise.resolve(done({data:rows,error:null})); },
    };
    return query;
  } } as unknown as SupabaseClient;
  const matches=[{id:'match',team_a_id:'a',team_b_id:'b',score_a:11,score_b:4,updated_at:'2026-10-29'} as Match];
  assert.equal(await hasAmbiguousHistoricalRosters(db,matches,'singles'),true);
  const profiles=new Map(['replaced','actual-a','actual-b'].map(id=>[id,{id,dupr_id:`DUPR-${id}`} as Profile]));
  assert.deepEqual([...await collectMatchUserIds(db,matches,true)],['actual-a','actual-b']);
  const resolved=await resolveMatchPlayers(db,matches,profiles,true);
  assert.deepEqual(resolved[0].teamA.map(player=>player.userId),['actual-a']);
  assert.deepEqual(resolved[0].teamB.map(player=>player.userId),['actual-b']);
  assert.equal(resolved[0].format,'singles');
  assert.deepEqual([...await collectMatchUserIds(db,matches)],['replaced','actual-a','actual-b']);
  const historical = [{ ...matches[0], player_a1_id: 'replaced', player_b1_id: 'actual-b' } as Match];
  assert.equal(await hasAmbiguousHistoricalRosters(db,historical,'singles'),false);
  assert.deepEqual([...await collectMatchUserIds(db,historical,true)],['replaced','actual-b']);
  // Legacy upload/preflight also use historical IDs, never today's replacement roster.
  assert.deepEqual([...await collectMatchUserIds(db,historical)],['replaced','actual-b']);
  const legacyPlayed = await resolveMatchPlayers(db,historical,profiles);
  assert.deepEqual(legacyPlayed[0].teamA.map(player=>player.userId),['replaced']);
  assert.deepEqual(legacyPlayed[0].teamB.map(player=>player.userId),['actual-b']);
  const played = await resolveMatchPlayers(db,historical,profiles,true);
  assert.deepEqual(played[0].teamA.map(player=>player.userId),['replaced']);
  assert.deepEqual(played[0].teamB.map(player=>player.userId),['actual-b']);
  assert.equal(hasCompleteMatchRosters(played,'singles'),true);
  assert.equal(hasCompleteMatchRosters(played,'doubles'),false);
  assert.equal(hasCompleteMatchRosters([{...played[0],teamB:played[0].teamA}],'singles'),false);
});
