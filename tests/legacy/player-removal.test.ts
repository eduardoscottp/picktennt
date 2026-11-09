import assert from 'node:assert/strict';
import test, { before, beforeEach, mock } from 'node:test';

type Reply = { table: string; data?: unknown; count?: number; error?: { message: string } };
let replies: Reply[] = [];
let calls: { table: string; method: string; values?: unknown; filters: unknown[] }[] = [];
let signedIn = true;
const fake = {
  auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'admin' } : null }, error: null }) },
  async rpc(name: string, values: unknown) {
    const reply = replies.shift(); assert.equal(reply?.table,name);
    calls.push({ table:name, method:'rpc', values, filters:[] });
    return { data:reply.data ?? null,error:reply.error ?? null };
  },
  from(table: string) {
    const call = { table, method: 'select', values: undefined as unknown, filters: [] as unknown[] };
    const builder = {
      select() { return builder; },
      update(values: unknown) { call.method = 'update'; call.values = values; return builder; },
      delete() { call.method = 'delete'; return builder; },
      eq(...args: unknown[]) { call.filters.push(['eq', ...args]); return builder; },
      neq(...args: unknown[]) { call.filters.push(['neq', ...args]); return builder; },
      not(...args: unknown[]) { call.filters.push(['not', ...args]); return builder; },
      or(...args: unknown[]) { call.filters.push(['or', ...args]); return builder; },
      single() { return builder; }, maybeSingle() { return builder; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        try { const reply = replies.shift(); assert.equal(reply?.table, table); calls.push(call); return Promise.resolve(resolve({ data: reply.data ?? null, count: reply.count ?? null, error: reply.error ?? null })); }
        catch (error) { return Promise.resolve(reject(error)); }
      },
    };
    return builder;
  },
};
mock.module('../../lib/supabase/server.ts', { namedExports: { createClient: async () => fake } });
let actions: typeof import('../../lib/tournament/player-removal');
before(async () => { actions = await import('../../lib/tournament/player-removal'); });
beforeEach(() => { replies = []; calls = []; signedIn = true; });
function access(engine = 'legacy', isAdmin = true, type = 'doubles', status = 'registration') {
  return [
    { table: 'tournament_players', data: { user_id: 'player', tournament_id: 'event' } },
    { table: 'tournaments', data: { engine_version: engine, type, created_by: 'owner', status } },
    ...(engine === 'legacy' ? [{ table: 'tournament_admins', data: isAdmin ? { id: 'admin-row' } : null }] : []),
  ];
}
const team = { table: 'team_members', data: { team_id: 'team' } };
test('legacy removal requires authenticated administrator and never touches modular data', async () => {
  signedIn = false;
  await assert.rejects(actions.removePlayerSimple('tp'), /Sign in/);
  signedIn = true; replies = access('modular_v1');
  await assert.rejects(actions.removePlayerSimple('tp'), /management controls/);
  replies = access('legacy', false);
  await assert.rejects(actions.removePlayerSimple('tp'), /administrator/);
  assert.ok(calls.every(call => call.method === 'select'));
});
test('simple removal keeps the empty doubles team and scopes membership to this tournament', async () => {
  replies = [...access(), { table: 'rounds', count: 0 }, team, { table: 'team_members' }, { table: 'tournament_players' }];
  await actions.removePlayerSimple('tp');
  assert.equal(replies.length, 0);
  assert.ok(!calls.some(call => call.table === 'teams' && call.method === 'delete'));
  assert.ok(calls.find(call => call.table === 'team_members' && call.method === 'select')!.filters.some(filter => JSON.stringify(filter) === '["eq","tournament_id","event"]'));
  assert.deepEqual(calls.at(-1)?.values, { status: 'rejected' });
});
test('a failed membership deletion never reports success or rejects the player afterward', async () => {
  replies = [...access(), { table: 'rounds', count: 0 }, team, { table: 'team_members', error: { message: 'Write failed' } }];
  await assert.rejects(actions.removePlayerSimple('tp'), /Write failed/);
  assert.ok(!calls.some(call => call.table === 'tournament_players' && call.method === 'update'));
});
test('schedule deletion refuses a different event and existing played results', async () => {
  replies = access();
  await assert.rejects(actions.deleteAllRoundsAndRemovePlayer('tp', 'other'), /another tournament/);
  replies = [...access(), { table: 'matches', count: 1 }];
  await assert.rejects(actions.deleteAllRoundsAndRemovePlayer('tp', 'event'), /play or a result/);
  assert.ok(calls.every(call => call.method === 'select'));
});
test('prestart removal refuses after-start operations without touching player or matches', async () => {
  replies=access('legacy',true,'doubles','active');
  await assert.rejects(actions.removePlayerSimple('tp'),/Retirar equipo/);
  assert.ok(calls.every(call=>call.method==='select'));
});

test('confirmed team forfeit uses one session RPC and returns the affected count', async () => {
  replies=[{table:'legacy_forfeit_team',data:4}];
  assert.deepEqual(await actions.forfeitLegacyTeam('event','team'),{affectedMatches:4});
  assert.deepEqual(calls,[{table:'legacy_forfeit_team',method:'rpc',values:{p_tournament_id:'event',p_team_id:'team'},filters:[]}]);
});

test('team forfeit rejects unauthenticated and explains conflicting withdrawals without leaking SQL errors', async () => {
  signedIn=false;
  await assert.rejects(actions.forfeitLegacyTeam('event','team'),/Sign in/);
  assert.equal(calls.length,0);
  signedIn=true;
  replies=[{table:'legacy_forfeit_team',error:{message:'OPPONENT_WITHDRAWN'}}];
  await assert.rejects(actions.forfeitLegacyTeam('event','team'),/manual result management/);
  replies=[{table:'legacy_forfeit_team',error:{message:'BRACKET_REVIEW_REQUIRED'}}];
  await assert.rejects(actions.forfeitLegacyTeam('event','team'),/cruce ya asignado/);
  replies=[{table:'legacy_forfeit_team',error:{message:'internal table secret'}}];
  await assert.rejects(actions.forfeitLegacyTeam('event','team'),/^Error: Could not withdraw this team\.$/);
});
