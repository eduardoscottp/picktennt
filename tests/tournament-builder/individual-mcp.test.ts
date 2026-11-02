import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { handleMcpRequest } from '../../lib/tournament-builder/mcp-http';
import { createOAuthConfig, createOAuthSecret, permissionsForOAuthScope, oauthScopeForPermissions } from '../../lib/tournament-builder/oauth';
import { confirmationQuestion } from '../../lib/tournament-builder/mcp-confirmation';

test('participation requires explicit new consent without expanding existing grants', () => {
  assert.deepEqual(permissionsForOAuthScope('tournaments:play'), ['player:manage']);
  assert.equal(oauthScopeForPermissions(['player:manage']), 'tournaments:play');
  assert.ok(!permissionsForOAuthScope('tournaments:draft tournaments:admin tournaments:owner').includes('player:manage'));
});

for (const origin of ['https://chatgpt.com', 'https://claude.ai']) test(`${origin} receives human confirmation text and separate machine references`, async () => {
  const config = createOAuthConfig('https://picktennt.example'), token = createOAuthSecret(), id = randomUUID();
  let calls = 0;
  const dependencies = { config, verifyToken: async () => ({ user_id: id, client_id: 'test-client', grant_id: id, resource: config.resource, scopes: ['admin:manage', 'draft:read', 'player:manage'] }),
    forActor: () => ({ player: { snapshot: async () => ({}) }, admin: { snapshot: async () => ({}), findPlayer: async () => ({}), previewCorrection: async () => ({}), previewWithdrawal: async () => ({}), previewSchedule: async () => ({ event_revision: 7, preview_hash: 'a'.repeat(64), fixtures: [{ id }] }) }, execute: async () => { calls++; return {}; }, getDraft: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}) }),
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await handleMcpRequest(new Request(config.resource, { method: 'POST', headers: { authorization: `Bearer ${token.value}`, origin, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), dependencies);
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  const preview = await call('admin_preview_schedule', { tournament_id: id, data: { reviewed_roster_revision: 3 } });
  assert.equal(preview.content[0].text, 'Close player positions and generate the reviewed schedule of 1 games?');
  assert.doesNotMatch(preview.content[0].text, /[{}]|[a-f0-9]{8}-|preview_hash|admin_|fixture|payload/i);
  assert.equal(preview.structuredContent.preview_hash, 'a'.repeat(64));
  for (const approval of [undefined, false]) {
    const denied = await call('admin_lock_roster', { tournament_id: id, operation_id: id, expected_revision: 7, data: { reviewed_roster_revision: 3 }, ...(approval === undefined ? {} : { confirmed_structure_change: approval }) });
    assert.equal(denied.isError, true);
    assert.doesNotMatch(denied.content[0].text, /[{}]|admin_|confirmed_|preview_hash/);
  }
  assert.equal(calls, 0);
  await call('admin_lock_roster', { tournament_id: id, operation_id: id, expected_revision: 7, data: { reviewed_roster_revision: 3 }, confirmed_structure_change: true });
  assert.equal(calls, 1);
});

test('confirmation vocabulary never forwards arbitrary labels, names, identifiers or raw payloads', () => {
  for (const name of ['preview_tournament', 'admin_preview_revision', 'admin_preview_correction', 'admin_preview_withdrawal', 'admin_close_registration', 'admin_reopen_registration', 'admin_remove_registered_player']) {
    const question = confirmationQuestion(name, { definition: { event: { name: 'RAW_SECRET', starts_at: '2030-11-07T09:00:00Z' }, registration: { entry_type: 'fixed_doubles', max_entries: 8 } }, affected_match_ids: [randomUUID()] }, { data: { user_id: randomUUID() } })!;
    assert.equal((question.match(/\?/g) ?? []).length, 1);
    assert.doesNotMatch(question, /RAW_SECRET|[{}]|[a-f0-9]{8}-|admin_|user_id|payload|module|preview_hash/);
  }
});
