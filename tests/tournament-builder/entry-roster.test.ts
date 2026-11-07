import assert from 'node:assert/strict';
import test from 'node:test';
import { entryPlayerIds } from '../../lib/tournament-builder/entry-roster';

test('an active team uses current players while a withdrawn team retains historical participants', () => {
  const members = [{ id: 'old', team_id: 'team', user_id: 'old-player', membership_status: 'withdrawn' }, { id: 'new', team_id: 'team', user_id: 'new-player', membership_status: 'active' }, { id: 'invite', team_id: 'team', user_id: 'invitee', membership_status: 'pending' }];
  assert.deepEqual(entryPlayerIds({ teams: [{ id: 'team', entry_state: 'approved' }], team_members: members }, 'team'), ['new-player']);
  assert.deepEqual(entryPlayerIds({ teams: [{ id: 'team', entry_state: 'withdrawn' }], team_members: members.filter(member => member.id !== 'invite') }, 'team'), ['old-player', 'new-player']);
});
