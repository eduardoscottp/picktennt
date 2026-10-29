import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { isOwnerAction, OWNER_ACTIONS, type OwnerAction } from './owner-actions';
import { DomainError, parseEnvelope, UUID } from './requests';

export interface OwnerMcpDependencies {
  snapshot(id: string): Promise<unknown>;
  findPlayer(id: string, username: string): Promise<unknown>;
  previewAction(id: string, action: OwnerAction, data: Record<string, unknown>): Promise<unknown>;
}
const uuid = { type: 'string', format: 'uuid' };
const object = (properties: Record<string, object>, required = Object.keys(properties)): Tool['inputSchema'] => ({ type: 'object', properties, required, additionalProperties: false });
const action = { type: 'string', enum: [...OWNER_ACTIONS] };
const data = object({ reason: { type: 'string', minLength: 1, maxLength: 1000 }, user_id: uuid, reviewed_definition_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, acknowledged_warning_codes: { type: 'array', items: { type: 'string' }, uniqueItems: true } }, []);
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const OWNER_TOOLS: Tool[] = [
  { name: 'owner_get_tournament', description: 'Read the current tournament, exact revision, rules, matches, results and administrators. Requires explicit owner scope and current ownership; does not grant routine administrator or draft permissions. Matches are returned in pages of 64; pass match_page.next_offset as match_offset to read the next page at the same tournament revision.', inputSchema: object({ tournament_id: uuid, match_offset: { type: 'integer', minimum: 0, maximum: 1000000 } }, ['tournament_id']), annotations: read },
  { name: 'owner_find_player', description: 'Find an existing Picktennt profile by exact username before proposing an administrator change. Returns only its account ID, username and display name; never creates accounts or enrolls players.', inputSchema: object({ tournament_id: uuid, username: { type: 'string', pattern: '^[a-zA-Z0-9_]{3,32}$' } }), annotations: read },
  { name: 'owner_preview_action', description: 'Read the exact current owner action proposal and impact. For publication use empty data to derive the complete saved rules and warnings. Other actions require a reason; administrator changes also require an existing user_id. Show the returned data and concrete impact to the owner and ask whether to proceed. This does not change the tournament.', inputSchema: object({ tournament_id: uuid, action, data }), annotations: read },
  { name: 'owner_commit_action', description: 'Apply only the exact owner_preview_action proposal after the owner explicitly confirms its concrete impact. Copy its canonical data, event_revision and preview_hash. Changed facts require a fresh preview and confirmation. Reuse operation_id and the exact request after an uncertain response; get_operation recovers its receipt.', inputSchema: object({ tournament_id: uuid, action, data, expected_revision: { type: 'integer', minimum: 0 }, operation_id: uuid, confirmed_owner_action: { type: 'boolean', const: true }, reviewed_action_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];
export async function callOwnerTool(name: string, args: Record<string, unknown>, owner: OwnerMcpDependencies, execute: (command: string, id: string, input: unknown) => Promise<unknown>): Promise<unknown> {
  const id = args.tournament_id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new DomainError('INVALID_REQUEST', 'A tournament UUID is required.');
  if (name === 'owner_get_tournament') return owner.snapshot(id);
  if (name === 'owner_find_player') {
    if (typeof args.username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(args.username)) throw new DomainError('INVALID_REQUEST', 'Provide the exact Picktennt username.');
    return owner.findPlayer(id, args.username.toLowerCase());
  }
  if (typeof args.action !== 'string' || !isOwnerAction(args.action)) throw new DomainError('INVALID_REQUEST', 'Unsupported owner action.');
  if (!args.data || typeof args.data !== 'object' || Array.isArray(args.data) || Object.keys(args.data).some(key => !Object.hasOwn(data.properties ?? {}, key))) throw new DomainError('INVALID_REQUEST', 'Provide only the owner action proposal data.');
  const proposal = args.data as Record<string, unknown>;
  if (name === 'owner_preview_action') return owner.previewAction(id, args.action, proposal);
  if (name !== 'owner_commit_action') throw new DomainError('INVALID_REQUEST', 'Unknown owner tool.');
  if (args.confirmed_owner_action !== true || typeof args.reviewed_action_hash !== 'string' || !/^[a-f0-9]{64}$/.test(args.reviewed_action_hash)) throw new DomainError('CONFIRMATION_REQUIRED', 'Show the current owner action preview and obtain explicit confirmation before committing.');
  // Repository receipt recovery precedes current-state planning; do not re-preview a completed retry here.
  return execute(args.action, id, parseEnvelope({ operation_id: args.operation_id, expected_revision: args.expected_revision, data: { ...proposal, confirmed_owner_action: true, reviewed_action_hash: args.reviewed_action_hash } }));
}
