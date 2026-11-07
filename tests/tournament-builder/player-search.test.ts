import assert from 'node:assert/strict';
import test from 'node:test';
import { playerSearchFilter, requirePlayerSearchAdmin } from '../../lib/tournament-builder/player-search';

test('player search accepts names, email and DUPR IDs without filter injection', () => {
  assert.match(playerSearchFilter('Ana Ruiz'), /and\(first_name\.ilike\.%Ana%,last_name\.ilike\.%Ruiz%\)/);
  assert.match(playerSearchFilter('ana@example.com'), /email\.ilike\.%ana@example\.com%/);
  assert.match(playerSearchFilter('DUPR123'), /dupr_id\.ilike\.%DUPR123%/);
  for (const input of ['ab', 'ana,role.eq.admin', 'ana%','ana*', 'x'.repeat(81)]) assert.throws(() => playerSearchFilter(input));
});
test('search requires the verified tournament administrator role', () => {
  for (const role of ['owner', 'admin']) assert.doesNotThrow(() => requirePlayerSearchAdmin(role));
  for (const role of ['player', 'viewer', '']) assert.throws(() => requirePlayerSearchAdmin(role), { code: 'FORBIDDEN' });
});
