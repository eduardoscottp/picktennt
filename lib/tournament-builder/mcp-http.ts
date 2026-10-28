import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createTournamentMcpServer, type McpDependencies } from './mcp';
import { hashOAuthSecret, OAUTH_SCOPES, type OAuthConfig } from './oauth';
import type { CommandActor } from './commands';

export interface McpHttpDependencies {
  config: OAuthConfig;
  verifyToken(hash: string, resource: string): Promise<Record<string, unknown>>;
  forActor(actor: CommandActor): McpDependencies;
}
export async function handleMcpRequest(request: Request, dependencies: McpHttpDependencies): Promise<Response> {
  const { config } = dependencies;
  const origin = request.headers.get('origin');
  if (origin && ![config.issuer, 'https://chatgpt.com', 'https://claude.ai'].includes(origin)) return new Response('Forbidden origin', { status: 403 });
  const unauthorized = () => new Response(null, { status: 401, headers: {
    'WWW-Authenticate': `Bearer resource_metadata="${config.protectedResourceMetadataUrl}", scope="${OAUTH_SCOPES.join(' ')}"`,
    'Cache-Control': 'no-store',
  } });
  const match = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/i);
  if (!match) return unauthorized();
  // Database verification includes expiration, token-family revocation and current grant status.
  const identity = await dependencies.verifyToken(hashOAuthSecret(match[1]), config.resource);
  if (identity.error || typeof identity.user_id !== 'string' || typeof identity.client_id !== 'string' ||
    typeof identity.grant_id !== 'string' || identity.resource !== config.resource ||
    !Array.isArray(identity.scopes) || !identity.scopes.every((scope) => typeof scope === 'string') || !identity.scopes.some((scope) => scope === 'draft:read' || scope === 'admin:manage' || scope === 'owner:manage')) return unauthorized();
  const server = createTournamentMcpServer(dependencies.forActor({ id: identity.user_id, clientId: identity.client_id, grantId: identity.grant_id, permissions: [...identity.scopes] }));
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 65536 });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally { await server.close(); }
}
