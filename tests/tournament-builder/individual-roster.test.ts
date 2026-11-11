import test from 'node:test';
import assert from 'node:assert/strict';
import { adminPlacement } from '../../lib/tournament-builder/individual-roster';

test('admin placement distinguishes new, movable and locked or pending players', () => {
  const active = [{ id: 'member', user_id: 'player', membership_status: 'active' }];
  const pending = [{ id: 'member', user_id: 'player', membership_status: 'pending' }];
  assert.equal(adminPlacement(active, 'new', false), 'add');
  assert.equal(adminPlacement(active, 'player', false), 'move');
  assert.equal(adminPlacement(active, 'player', true), 'blocked');
  assert.equal(adminPlacement(pending, 'player', false), 'blocked');
});
