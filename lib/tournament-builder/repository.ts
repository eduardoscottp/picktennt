import { createHash, randomInt, randomUUID } from 'node:crypto';
import { DomainError, parseEnvelope, requestHash } from './requests';
import { planCommand, type CommandActor, type CommandSnapshot } from './commands';
import { previewDefinition } from './preview';
import { resolvedDefinition } from './resolved-definition';

export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export interface CommandReceipt { operation_id: string; tournament_id: string; revision: number; status: string; data: Record<string, unknown> }

const safeCodes = /\b(NOT_REGISTERED|SLOT_FULL|ACCOUNT_REQUIRED|UNAUTHENTICATED|FORBIDDEN|NOT_FOUND|GRANT_REVOKED|INVALID_STATE|STRUCTURE_LOCKED|STALE_PREVIEW|STALE_REVISION|IDEMPOTENCY_CONFLICT|CAPACITY_FULL|REGISTRATION_CLOSED|DUPLICATE_ENTRY|INCOMPLETE_ROSTER|COURT_BUSY|PLAYER_BUSY|REST_REQUIRED|PUBLISHED_DEFINITION|INVALID_SCORE|INVALID_EFFECTS)\b/;
export async function callRpc<T>(db: RpcClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const code = error.message.match(safeCodes)?.[1];
    throw new DomainError(code ?? 'INTERNAL_ERROR', code ? code.replaceAll('_', ' ').toLowerCase() : 'The operation could not be completed.');
  }
  return data as T;
}

/** Stable server identity makes an uncertain create retry address the same event. */
function draftId(actor: CommandActor, operationId: string): string {
  const digest = createHash('sha256').update(JSON.stringify([actor.id, actor.clientId, operationId])).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
function shuffled(ids: readonly string[]): string[] {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
const actorArgs = (actor: CommandActor) => ({ p_actor_id: actor.id, p_client_id: actor.clientId, p_grant_id: actor.grantId ?? null });
export async function getSnapshot(db: RpcClient, actor: CommandActor, tournamentId: string): Promise<CommandSnapshot & { caller_role: string }> {
  return callRpc(db, 'tb_get_snapshot', { ...actorArgs(actor), p_tournament_id: tournamentId });
}
export async function getOperation(db: RpcClient, actor: CommandActor, operationId: string): Promise<CommandReceipt> {
  return callRpc(db, 'tb_get_operation', { ...actorArgs(actor), p_operation_id: operationId });
}

export async function executeCommand(db: RpcClient, actor: CommandActor, command: string, tournamentId: string | null, input: unknown): Promise<CommandReceipt> {
  const creating = command === 'createDraft';
  const envelope = parseEnvelope(input, creating);
  if (!creating && !tournamentId) throw new DomainError('INVALID_REQUEST', 'A tournament is required.');
  const id = creating ? draftId(actor, envelope.operation_id) : tournamentId!;
  const hash = requestHash(command, id, envelope.expected_revision, envelope.data);
  // This RPC reauthorizes against CURRENT access before reading a historical receipt.
  const receipt = await callRpc<CommandReceipt | null>(db, 'tb_get_operation', {
    ...actorArgs(actor), p_operation_id: envelope.operation_id, p_tournament_id: id,
    p_command: command, p_request: envelope.data, p_request_hash: hash,
  });
  if (receipt) return receipt;
  const empty: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  const snapshot = creating ? empty : await getSnapshot(db, actor, id);
  if (!creating && snapshot.event?.revision !== envelope.expected_revision) throw new DomainError('STALE_REVISION', 'This tournament changed. Refresh before submitting again.');
  const callerRole = 'caller_role' in snapshot ? snapshot.caller_role : undefined;
  const verifiedActor: CommandActor = { ...actor, role: callerRole === 'owner' || callerRole === 'admin' ? callerRole : 'player' };
  const plan = planCommand(snapshot, verifiedActor, command, envelope.data, { now: new Date().toISOString(), id: randomUUID, draw: shuffled });
  return callRpc(db, 'tb_apply_command', {
    ...actorArgs(actor), p_operation_id: envelope.operation_id, p_request_hash: hash, p_command: command,
    p_tournament_id: id, p_expected_revision: creating ? null : envelope.expected_revision, p_request: envelope.data,
    p_effects: plan.effects, p_result: plan.result,
  });
}

export async function previewTournament(db: RpcClient, actor: CommandActor, tournamentId: string) {
  const snapshot = await getSnapshot(db, actor, tournamentId);
  const definition = resolvedDefinition(snapshot);
  return previewDefinition(definition?.definition ?? {}, Number(snapshot.event?.revision ?? 0));
}
