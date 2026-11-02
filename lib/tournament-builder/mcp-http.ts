import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createTournamentMcpServer, type McpDependencies } from './mcp';
import { hashOAuthSecret, OAUTH_SCOPES, type OAuthConfig } from './oauth';
import type { CommandActor } from './commands';
import { assertMcpJson } from './mcp-security';
import { DRAFT_PERMISSIONS } from './oauth';

const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function rejected(status: number) {
  return Response.json({ error: status === 503 ? 'Service unavailable.' : 'Request rejected.' }, { status, headers: privateHeaders });
}
async function rpcBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !request.body) throw new Error('invalid');
  if (Number(request.headers.get('content-length')) > 65536) throw new Error('large');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error('large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assertMcpJson(body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
  const rpc = body as Record<string, unknown>;
  if (rpc.jsonrpc !== '2.0' || Object.keys(rpc).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key))) throw new Error('invalid');
  if (rpc.id !== undefined && !(typeof rpc.id === 'number' && Number.isSafeInteger(rpc.id)) && !(typeof rpc.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(rpc.id))) throw new Error('invalid');
  if (!['initialize', 'ping', 'tools/list', 'tools/call', 'notifications/initialized', 'notifications/cancelled'].includes(String(rpc.method))) throw new Error('invalid');
  if (String(rpc.method).startsWith('notifications/') ? rpc.id !== undefined : rpc.id === undefined) throw new Error('invalid');
  if (rpc.params !== undefined && (!rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params))) throw new Error('invalid');
  if (rpc.method === 'tools/call') {
    const params = rpc.params as Record<string, unknown> | undefined;
    if (!params || typeof params.name !== 'string' || params.name.length > 80 || Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key)) || (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)))) throw new Error('invalid');
  }
  return rpc;
}

export interface McpHttpDependencies {
  config: OAuthConfig;
  verifyToken(hash: string, resource: string): Promise<Record<string, unknown>>;
  rateLimit?(actorId: string): Promise<{ allowed: boolean; retry_after?: number }>;
  forActor(actor: CommandActor): McpDependencies;
}
export async function handleMcpRequest(request: Request, dependencies: McpHttpDependencies): Promise<Response> {
  const { config } = dependencies;
  const origin = request.headers.get('origin');
  if (origin && ![config.issuer, 'https://chatgpt.com', 'https://claude.ai'].includes(origin)) return rejected(403);
  const unauthorized = () => new Response(null, { status: 401, headers: {
    'WWW-Authenticate': `Bearer resource_metadata="${config.protectedResourceMetadataUrl}", scope="${OAUTH_SCOPES.join(' ')}"`,
    ...privateHeaders,
  } });
  const match = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/i);
  if (!match) return unauthorized();
  // Database verification includes expiration, token-family revocation and current grant status.
  let identity: Record<string, unknown>;
  try { identity = await dependencies.verifyToken(hashOAuthSecret(match[1]), config.resource); }
  catch { return rejected(503); }
  if (!identity || typeof identity !== 'object') return unauthorized();
  if (identity.error || typeof identity.user_id !== 'string' || typeof identity.client_id !== 'string' ||
    typeof identity.grant_id !== 'string' || identity.resource !== config.resource ||
    !identity.user_id || !identity.client_id || !identity.grant_id || identity.client_id === 'web' ||
    !Array.isArray(identity.scopes) || !identity.scopes.every((scope) => [...DRAFT_PERMISSIONS, 'admin:manage', 'owner:manage', 'player:manage'].includes(scope)) || !identity.scopes.some((scope) => scope === 'draft:read' || scope === 'admin:manage' || scope === 'owner:manage' || scope === 'player:manage')) return unauthorized();
  if (dependencies.rateLimit) {
    try {
      const limit = await dependencies.rateLimit(identity.user_id);
      if (limit.allowed !== true) {
        const response = rejected(429);
        response.headers.set('Retry-After', String(Number.isSafeInteger(limit.retry_after) ? Math.max(1, Math.min(3600, limit.retry_after!)) : 60));
        return response;
      }
    } catch { return rejected(503); }
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: 'POST' } });
  let parsedBody: Record<string, unknown>;
  try { parsedBody = await rpcBody(request); } catch { return rejected(400); }
  const actorDependencies = dependencies.forActor({ id: identity.user_id, clientId: identity.client_id, grantId: identity.grant_id, permissions: [...identity.scopes] });
  const server = createTournamentMcpServer({ ...actorDependencies, player: identity.scopes.includes('player:manage') ? actorDependencies.player : undefined, admin: identity.scopes.includes('admin:manage') ? actorDependencies.admin : undefined, owner: identity.scopes.includes('owner:manage') ? actorDependencies.owner : undefined, permissions: [...identity.scopes], reviewLink: async id => {
    const value = await actorDependencies.reviewLink(id);
    if (!value || typeof value !== 'object' || (value as Record<string, unknown>).review_url !== `${config.issuer}/tournaments/${id}/builder`) throw new Error('Invalid review link.');
    return value;
  } });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 65536 });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody });
    if (response.status >= 400) return rejected(response.status);
    if (response.headers.get('content-type')?.includes('application/json')) {
      const body = await response.clone().json();
      // SDK validation errors can carry schema diagnostics in a 200 response.
      if (body.error) return Response.json({ jsonrpc: '2.0', id: parsedBody.id ?? null, error: { code: -32600, message: 'Request rejected.' } }, { headers: privateHeaders });
    }
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  } catch { return rejected(503); }
  finally { await server.close(); }
}
