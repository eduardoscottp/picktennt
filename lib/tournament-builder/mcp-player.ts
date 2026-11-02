import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { parseEnvelope } from './requests';

const uuid = { type: 'string', format: 'uuid' };
const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: 'object' as const, properties, required, additionalProperties: false });
const position = { slot_index: { type: 'integer', minimum: 1, maximum: 16 }, position: { type: 'integer', minimum: 1, maximum: 2 } };
const commands = {
  player_join_tournament: { command: 'joinTournament', data: object({ definition_id: uuid, consent: { type: 'boolean', const: true }, ...position }), description: 'Join an available individual position using only your connected account. Read the published rules and obtain your explicit acceptance first. No names, partner approval or other player identity may be supplied.' },
  player_select_position: { command: 'selectEntrySlot', data: object(position), description: 'Move your own registered account into an available individual position before fixtures. Explain the move first. Never move another player.' },
  player_cancel_registration: { command: 'cancelRegistration', data: object({}), description: 'Cancel only your own registration before fixtures after you explicitly request to leave.' },
};
export const PLAYER_TOOLS: Tool[] = [
  { name: 'player_get_tournament', description: 'Read the authorized published tournament, current individual positions and registration rules for your connected account.', inputSchema: object({ tournament_id: uuid }), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  ...Object.entries(commands).map(([name, spec]) => ({ name, description: spec.description, inputSchema: object({ tournament_id: uuid, operation_id: uuid, expected_revision: { type: 'integer', minimum: 0 }, data: spec.data }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } })),
];
export async function callPlayerTool(name: string, args: Record<string, unknown>, player: { snapshot(id: string): Promise<unknown> }, execute: (command: string, id: string, input: unknown) => Promise<unknown>) {
  const id = String(args.tournament_id);
  if (name === 'player_get_tournament') return player.snapshot(id);
  const spec = commands[name as keyof typeof commands];
  return execute(spec.command, id, parseEnvelope({ operation_id: args.operation_id, expected_revision: args.expected_revision, data: args.data }));
}
