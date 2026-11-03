import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, owner, stranger } from './helpers/storage-db';
import { executeCommand, getSnapshot, getOperation, previewTournament, callRpc, type RpcClient } from '../../lib/tournament-builder/repository';
import { handleMcpRequest } from '../../lib/tournament-builder/mcp-http';
import { createOAuthConfig, createOAuthSecret, hashOAuthSecret } from '../../lib/tournament-builder/oauth';
import type { CommandActor } from '../../lib/tournament-builder/commands';

let db: PGlite;
const config = createOAuthConfig('https://picktennt.example');
const canary = 'Unrelated private event';
before(async () => {
  db = await storageDatabase();
  for (const file of ['202610280002_tournament_connector_oauth.sql', '202610280008_tournament_connector_administration.sql', '202610280009_tournament_connector_owner_actions.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
});
after(async () => { await db?.close(); });
const rpc: RpcClient = { async rpc(name, args) {
  assert.ok(['tb_get_snapshot', 'tb_get_operation', 'tb_apply_command', 'tb_oauth_store'].includes(name));
  try {
    const keys = Object.keys(args);
    const result = await role(db, 'service_role', owner, () => db.query<{ value: unknown }>(`SELECT public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) value`, Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value)));
    return { data: result.rows[0].value, error: null };
  } catch (error) { return { data: null, error: { message: String(error) } }; }
} };
const store = (action: string, payload: Record<string, unknown>) => callRpc<Record<string, unknown>>(rpc, 'tb_oauth_store', { p_action: action, p_payload: payload });

async function connection(actorId = owner, scopes = ['draft:read', 'draft:create', 'draft:update', 'operation:read']) {
  const token = createOAuthSecret(), grant = randomUUID();
  const client = await store('register_client', { client_name: 'Synthetic security client', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
  const requestId = randomUUID(), code = createOAuthSecret();
  await store('create_authorization', { id: requestId, client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: config.resource, scopes, state: 'synthetic-state', actor_id: actorId, csrf_hash: hashOAuthSecret('synthetic-csrf'), code_challenge: 'x'.repeat(43), expires_at: new Date(Date.now() + 600000).toISOString() });
  await store('approve_authorization', { request_id: requestId, actor_id: actorId, csrf_hash: hashOAuthSecret('synthetic-csrf'), grant_id: grant, code_hash: code.hash });
  const exchanged = await store('exchange_code', { code_hash: code.hash, client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: config.resource, code_challenge: 'x'.repeat(43), access_hash: token.hash, family_id: randomUUID() });
  assert.equal(exchanged.user_id, actorId);
  const dependencies = {
    config,
    verifyToken: (hash: string, resource: string) => store('verify_token', { token_hash: hash, resource }),
    rateLimit: async (id: string) => await store('rate_limit', { bucket: 'token', key_hash: hashOAuthSecret(`mcp:user:${id}`) }) as { allowed: boolean; retry_after?: number },
    forActor: (actor: CommandActor) => ({
      execute: (command: string, id: string | null, data: unknown) => executeCommand(rpc, actor, command, id, data),
      getDraft: async (id: string) => { const snapshot = await getSnapshot(rpc, actor, id); return { tournament_id: id, revision: snapshot.event!.revision, status: snapshot.event!.modular_state, definition: snapshot.definitions.find(definition => definition.id === snapshot.event!.definition_id)?.definition }; },
      preview: (id: string) => previewTournament(rpc, actor, id),
      operation: async (id: string, operation: string) => { const receipt = await getOperation(rpc, actor, operation); assert.equal(receipt.tournament_id, id); return receipt; },
      reviewLink: async (id: string) => { await getSnapshot(rpc, actor, id); return { tournament_id: id, review_url: `${config.issuer}/tournaments/${id}/builder` }; },
    }),
  };
  const send = async (name: string, args: Record<string, unknown>) => {
    const response = await handleMcpRequest(new Request(config.resource, { method: 'POST', headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), dependencies);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { token, grant, client, send };
}
async function privateDraft() {
  return executeCommand(rpc, { id: owner, clientId: 'web' }, 'createDraft', null, { operation_id: randomUUID(), data: { definition: { event: { name: canary } } } });
}

test('HTTP, token storage, repository and SQL jointly deny foreign draft reads, writes and receipt recovery', async () => {
  const draft = await privateDraft(), a = await connection(owner), b = await connection(stranger);
  const allowed = await a.send('get_draft', { tournament_id: draft.tournament_id });
  assert.match(JSON.stringify(allowed.body), new RegExp(canary));
  for (const [name, args] of [
    ['get_draft', { tournament_id: draft.tournament_id }],
    ['get_review_link', { tournament_id: draft.tournament_id }],
    ['get_operation', { tournament_id: draft.tournament_id, operation_id: draft.operation_id }],
    ['update_draft', { tournament_id: draft.tournament_id, operation_id: randomUUID(), expected_revision: draft.revision, data: { definition: { event: { name: 'Stolen' } } } }],
  ] as const) {
    const response = await b.send(name, args);
    assert.equal(response.body.result.isError, true, name);
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(canary));
  }
  assert.equal((await getSnapshot(rpc, { id: owner, clientId: 'web' }, draft.tournament_id)).event!.revision, draft.revision);
});

test('permission reduction and grant revocation block the next actual HTTP operation', async () => {
  const draft = await privateDraft(), a = await connection();
  await db.query("UPDATE connection_grants SET permissions=ARRAY['draft:read'] WHERE id=$1", [a.grant]);
  const mutation = await a.send('update_draft', { tournament_id: draft.tournament_id, operation_id: randomUUID(), expected_revision: draft.revision, data: { definition: { event: { name: 'Changed' } } } });
  assert.equal(mutation.body.result.isError, true);
  assert.equal((await a.send('get_draft', { tournament_id: draft.tournament_id })).body.result.isError, undefined);
  await store('revoke_grant', { actor_id: owner, grant_id: a.grant });
  assert.equal((await a.send('get_draft', { tournament_id: draft.tournament_id })).status, 401);
  assert.equal((await a.send('get_operation', { tournament_id: draft.tournament_id, operation_id: draft.operation_id })).status, 401);
});

test('MCP throttling is durable across clients and separate from OAuth IP buckets', async () => {
  const account = randomUUID(), key_hash = hashOAuthSecret(`mcp:user:${account}`);
  for (let index = 0; index < 60; index++) assert.equal((await store('rate_limit', { bucket: 'token', key_hash })).allowed, true);
  assert.equal((await store('rate_limit', { bucket: 'token', key_hash })).allowed, false);
  assert.equal((await store('rate_limit', { bucket: 'token', key_hash: hashOAuthSecret('127.0.0.1') })).allowed, true);
  assert.equal((await store('rate_limit', { bucket: 'token', key_hash: hashOAuthSecret(`mcp:user:${randomUUID()}`) })).allowed, true);
});

test('SQL and executable strings are stored as inert draft text without changing accounts or grants', async () => {
  const a = await connection(), before = await db.query('SELECT id,permissions FROM connection_grants ORDER BY id');
  const payload = "'; DROP TABLE profiles; -- $(Get-Content .env) require('node:fs').readFileSync('/etc/passwd')";
  const created = await a.send('create_draft', { operation_id: randomUUID(), data: { definition: { event: { name: payload } } } });
  assert.equal(created.body.result.isError, undefined);
  assert.deepEqual((await db.query('SELECT id,permissions FROM connection_grants ORDER BY id')).rows, before.rows);
  assert.equal((await db.query<{ n: number }>('SELECT count(*) n FROM profiles')).rows[0].n, 3);
  const receipt = JSON.parse(created.body.result.content[0].text);
  const snapshot = await getSnapshot(rpc, { id: owner, clientId: 'web' }, receipt.tournament_id);
  assert.equal((snapshot.definitions[0].definition as { event: { name: string } }).event.name, payload);
});
