import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpRequest } from '../../lib/tournament-builder/mcp-http';
import { createOAuthConfig, createOAuthSecret } from '../../lib/tournament-builder/oauth';
import type { CommandActor } from '../../lib/tournament-builder/commands';

test('streamable MCP advertises auth, executes discovery and rejects a revoked token immediately', async () => {
  const config = createOAuthConfig('https://picktennt.example');
  const token = createOAuthSecret(); let revoked = false; let verified = 0;
  const dependencies = { config,
    verifyToken: async (hash: string, resource: string) => { verified++; assert.equal(hash, token.hash); assert.equal(resource, config.resource); return revoked ? { error: 'invalid_token' } : { user_id: 'actor', client_id: 'client', grant_id: 'grant', resource, scopes: ['draft:read'] }; },
    forActor: () => ({ getDraft: async () => ({}), execute: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}) }),
  };
  const request = (authorized: boolean) => new Request(config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(authorized ? { authorization: `Bearer ${token.value}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const missing = await handleMcpRequest(request(false), dependencies);
  assert.equal(missing.status, 401);
  assert.ok(missing.headers.get('www-authenticate')?.includes(config.protectedResourceMetadataUrl));
  assert.equal(verified, 0);
  const response = await handleMcpRequest(request(true), dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.tools.length, 9);
  revoked = true;
  assert.equal((await handleMcpRequest(request(true), dependencies)).status, 401);
  assert.equal(verified, 2);
});

test('MCP passes only verified permissions, accepts admin-only grants and rejects empty or revoked scope', async () => {
  const config = createOAuthConfig('https://picktennt.example');
  const token = createOAuthSecret();
  let scopes: unknown = ['draft:read']; let revoked = false;
  const actors: CommandActor[] = [];
  const dependencies = { config,
    verifyToken: async () => ({ user_id: 'owner', client_id: 'client', grant_id: 'grant', resource: config.resource, scopes, ...(revoked ? { error: 'invalid_token' } : {}) }),
    forActor: (actor: CommandActor) => { actors.push(actor); return { getDraft: async () => ({}), execute: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}) }; },
  };
  const request = () => new Request(config.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token.value}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  assert.equal((await handleMcpRequest(request(), dependencies)).status, 200);
  assert.deepEqual(actors.at(-1)?.permissions, ['draft:read']);
  scopes = ['admin:manage'];
  assert.equal((await handleMcpRequest(request(), dependencies)).status, 200);
  assert.deepEqual(actors.at(-1)?.permissions, ['admin:manage']);
  scopes = ['owner:manage'];
  assert.equal((await handleMcpRequest(request(), dependencies)).status, 200);
  assert.deepEqual(actors.at(-1)?.permissions, ['owner:manage']);
  for (scopes of [[], ['operation:read'], ['tournaments:admin'], ['admin:manage', 1], null]) {
    const response = await handleMcpRequest(request(), dependencies);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate')!, /scope="tournaments:draft tournaments:admin tournaments:owner"/);
  }
  scopes = ['admin:manage']; revoked = true;
  assert.equal((await handleMcpRequest(request(), dependencies)).status, 401);
  assert.equal(actors.length, 3);
});

