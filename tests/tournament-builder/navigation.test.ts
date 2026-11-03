import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTournamentPath, tournamentPath, type TournamentView } from '../../lib/tournament-builder/navigation';
import { loadTournamentPage, type TournamentPageDependencies } from '../../lib/tournament-builder/page-loader';
import { DomainError } from '../../lib/tournament-builder/requests';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
const id = '00000000-0000-4000-8000-000000000001';
const owner = '00000000-0000-4000-8000-000000000002';
const member = '00000000-0000-4000-8000-000000000003';
const views: TournamentView[] = ['overview', 'matches', 'standings', 'admin'];
const snapshot = (state = 'active', caller_role = 'owner'): CommandSnapshot & { caller_role: string } => ({ event: { id, created_by: owner, engine_version: 'modular_v1', modular_state: state }, caller_role, definitions: [], teams: [], team_members: [], tournament_players: [], rounds: [], matches: [], stages: [], standings: [] });
function setup(state = 'active', caller_role = 'owner', userId = owner) {
  const calls: string[] = [];
  const deps: TournamentPageDependencies = { enabled: true,
    lookupEngine: async () => { calls.push('engine'); return 'modular_v1'; },
    currentUser: async () => { calls.push('auth'); return { id: userId }; },
    getSnapshot: async (eventId, actorId) => { calls.push('snapshot'); assert.equal(eventId, id); assert.equal(actorId, userId); return snapshot(state, caller_role); },
  };
  return { deps, calls };
}
test('normal published views render distinct routes; published builder bookmark converges without a loop', async () => {
  const { deps } = setup();
  for (const view of views) {
    const result = await loadTournamentPage(id, view, deps);
    assert.equal(result.kind, 'render');
    if (result.kind === 'render') { assert.equal(result.view, view); assert.equal(result.actorId, owner); }
  }
  assert.equal(tournamentPath(id, 'standings'), `/tournaments/${id}/leaderboard`);
  assert.deepEqual(await loadTournamentPage(id, 'builder', deps), { kind: 'redirect', location: tournamentPath(id, 'overview') });
  assert.equal((await loadTournamentPage(id, 'overview', deps)).kind, 'render');
});
test('draft views converge on editable builder; canonical join destination follows publication', async () => {
  const { deps } = setup('draft');
  for (const view of views) assert.deepEqual(await loadTournamentPage(id, view, deps), { kind: 'redirect', location: tournamentPath(id, 'builder') });
  assert.equal((await loadTournamentPage(id, 'builder', deps)).kind, 'render');
  assert.equal(canonicalTournamentPath(id, 'draft'), tournamentPath(id, 'builder'));
  for (const state of ['registration_open', 'registration_closed', 'ready', 'active', 'completed', 'cancelled']) assert.equal(canonicalTournamentPath(id, state), tournamentPath(id, 'overview'));
});
test('admin view allows owner and current delegated admin, denies ordinary member and viewer', async () => {
  for (const role of ['player', 'viewer']) {
    const { deps } = setup('active', role, member);
    assert.deepEqual(await loadTournamentPage(id, 'admin', deps), { kind: 'not_found' });
    assert.equal((await loadTournamentPage(id, 'matches', deps)).kind, 'render');
  }
  assert.equal((await loadTournamentPage(id, 'admin', setup('active', 'admin', member).deps)).kind, 'render');
  assert.equal((await loadTournamentPage(id, 'admin', setup('active', 'viewer', owner).deps)).kind, 'render');
});
test('legacy normal pages fall through unchanged without modular auth or snapshots; legacy builder returns overview', async () => {
  const { deps, calls } = setup(); deps.enabled = false; deps.lookupEngine = async () => { calls.push('engine'); return 'legacy'; };
  for (const view of views) assert.deepEqual(await loadTournamentPage(id, view, deps), { kind: 'legacy' });
  assert.deepEqual(await loadTournamentPage(id, 'builder', deps), { kind: 'redirect', location: tournamentPath(id, 'overview') });
  assert.deepEqual(calls, ['engine', 'engine', 'engine', 'engine', 'engine']);
});
test('invalid UUID and disabled modular routes fail closed before auth or snapshot', async () => {
  const { deps, calls } = setup();
  assert.deepEqual(await loadTournamentPage('bad-id', 'overview', deps), { kind: 'not_found' }); assert.deepEqual(calls, []);
  deps.enabled = false;
  assert.deepEqual(await loadTournamentPage(id, 'overview', deps), { kind: 'not_found' }); assert.deepEqual(calls, ['engine']);
});
test('authentication preserves requested normal return URL; denied snapshots and absent events do not render', async () => {
  const { deps, calls } = setup(); deps.currentUser = async () => null;
  assert.deepEqual(await loadTournamentPage(id, 'matches', deps), { kind: 'redirect', location: `/login?redirect=${encodeURIComponent(tournamentPath(id, 'matches'))}` });
  assert.deepEqual(calls, ['engine']);
  deps.currentUser = async () => ({ id: owner });
  for (const code of ['FORBIDDEN', 'NOT_FOUND']) { deps.getSnapshot = async () => { throw new DomainError(code, 'Denied'); }; assert.deepEqual(await loadTournamentPage(id, 'overview', deps), { kind: 'not_found' }); }
  deps.getSnapshot = async () => ({ ...snapshot(), event: null });
  assert.deepEqual(await loadTournamentPage(id, 'overview', deps), { kind: 'not_found' });
});
test('engine lookup and unexpected snapshot errors surface instead of falling into legacy pages', async () => {
  const { deps } = setup(); const unavailable = new Error('Database unavailable');
  deps.lookupEngine = async () => { throw unavailable; };
  await assert.rejects(loadTournamentPage(id, 'overview', deps), unavailable);
  deps.lookupEngine = async () => 'modular_v1'; deps.getSnapshot = async () => { throw unavailable; };
  await assert.rejects(loadTournamentPage(id, 'overview', deps), unavailable);
});
