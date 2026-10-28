import { ADMIN_TOOLS, callAdminTool, type AdminMcpDependencies } from './mcp-admin';
import { OWNER_TOOLS, callOwnerTool, type OwnerMcpDependencies } from './mcp-owner';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCapabilities, listModules } from './catalog';
import { definitionJsonSchema } from './definition-schema';
import { DomainError, parseEnvelope, UUID } from './requests';

export interface McpDependencies {
  /** Already authenticated connection. Each operation rechecks its current grant in the repository. */
  execute(command: string, tournamentId: string | null, input: unknown): Promise<unknown>;
  admin?: AdminMcpDependencies;
  owner?: OwnerMcpDependencies;
  getDraft(tournamentId: string): Promise<unknown>;
  preview(tournamentId: string): Promise<unknown>;
  operation(tournamentId: string, operationId: string): Promise<unknown>;
  reviewLink(tournamentId: string): Promise<unknown>;
}
const uuid = { type: 'string', format: 'uuid' };
const object = (properties: Record<string, object>, required: string[]): Tool['inputSchema'] => ({ type: 'object', properties, required, additionalProperties: false });
const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const TOURNAMENT_TOOLS: Tool[] = [
  { name: 'list_modules', description: 'List trusted tournament modules, supported rules and questions to ask the organizer. No executable code can be supplied.', inputSchema: object({}, []), annotations: readAnnotations },
  { name: 'get_capabilities', description: 'Read the complete and partial definition JSON Schemas, exact policy tokens, bounds, compositions, and consent requirements before proposing or updating a tournament.', inputSchema: object({}, []), annotations: readAnnotations },
  { name: 'create_draft', description: 'Create a private Picktennt tournament draft. Ask for missing facts; do not invent dates or player consent. Reuse the same operation_id after an uncertain response. This does not publish or enroll anyone.', inputSchema: object({ operation_id: uuid, data: object({ definition: definitionJsonSchema(true) }, ['definition']) }, ['operation_id', 'data']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'update_draft', description: 'Replace an unpublished definition after organizer instructions. Use the current revision and reuse operation_id on retries. Published definitions cannot be changed. This tool never enrolls participants. Account enrollment is a separate authorized administrator or participant action.', inputSchema: object({ tournament_id: uuid, operation_id: uuid, expected_revision: { type: 'integer', minimum: 0 }, data: object({ definition: definitionJsonSchema(true) }, ['definition']) }, ['tournament_id', 'operation_id', 'expected_revision', 'data']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'get_draft', description: 'Read the exact current saved definition, including an incomplete draft, with its revision. Preserve existing facts when replacing the draft.', inputSchema: object({ tournament_id: uuid }, ['tournament_id']), annotations: readAnnotations },
  ...(['validate_draft', 'preview_tournament', 'get_review_link'] as const).map(name => ({ name, description: name === 'get_review_link' ? 'Get the owner review link. The organizer reviews and publishes on Picktennt; this tool cannot publish.' : 'Review current draft rules, validation errors, missing decisions and warnings. Ask the organizer to resolve missing facts.', inputSchema: object({ tournament_id: uuid }, ['tournament_id']), annotations: readAnnotations })),
  { name: 'get_operation', description: 'Resolve an uncertain mutation using its original operation UUID. Do not create a new operation to retry an unknown outcome.', inputSchema: object({ tournament_id: uuid, operation_id: uuid }, ['tournament_id', 'operation_id']), annotations: readAnnotations },
];

export async function callTournamentTool(name: string, args: Record<string, unknown>, dependencies: McpDependencies): Promise<unknown> {
  const tool = [...TOURNAMENT_TOOLS, ...(dependencies.admin ? ADMIN_TOOLS : []), ...(dependencies.owner ? OWNER_TOOLS : [])].find(tool => tool.name === name);
  if (!tool) throw new DomainError('INVALID_REQUEST', 'Unknown tournament tool.');
  if (Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties ?? {}, key))) throw new DomainError('INVALID_REQUEST', 'Unknown tool argument.');
  if (name.startsWith('admin_') && dependencies.admin) return callAdminTool(name,args,dependencies.admin,(command,id,input)=>dependencies.execute(command,id,input));
  if (name.startsWith('owner_') && dependencies.owner) return callOwnerTool(name,args,dependencies.owner,(command,id,input)=>dependencies.execute(command,id,input));
  if (name === 'list_modules') return listModules();
  if (name === 'get_capabilities') return getCapabilities(Boolean(dependencies.admin), Boolean(dependencies.owner));
  if (name === 'create_draft') return dependencies.execute('createDraft', null, parseEnvelope(args, true));
  const tournamentId = args.tournament_id;
  if (typeof tournamentId !== 'string' || !UUID.test(tournamentId)) throw new DomainError('INVALID_REQUEST', 'A tournament UUID is required.');
  if (name === 'update_draft') {
    const envelope = { operation_id: args.operation_id, expected_revision: args.expected_revision, data: args.data };
    return dependencies.execute('updateDraft', tournamentId, parseEnvelope(envelope));
  }
  if (name === 'get_draft') return dependencies.getDraft(tournamentId);
  if (name === 'get_review_link') return dependencies.reviewLink(tournamentId);
  if (name === 'get_operation') {
    if (typeof args.operation_id !== 'string' || !UUID.test(args.operation_id)) throw new DomainError('INVALID_REQUEST', 'An operation UUID is required.');
    return dependencies.operation(tournamentId, args.operation_id);
  }
  return dependencies.preview(tournamentId);
}

export function createTournamentMcpServer(dependencies: McpDependencies): Server {
  const server = new Server({ name: 'picktennt-tournament-builder', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOURNAMENT_TOOLS, ...(dependencies.admin ? ADMIN_TOOLS : []), ...(dependencies.owner ? OWNER_TOOLS : [])] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const data = await callTournamentTool(request.params.name, request.params.arguments ?? {}, dependencies);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      const data = error instanceof DomainError ? { code: error.code, message: error.message, details: error.details } : { code: 'INTERNAL_ERROR', message: 'The operation could not be completed. Check its receipt before retrying.' };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  });
  return server;
}

