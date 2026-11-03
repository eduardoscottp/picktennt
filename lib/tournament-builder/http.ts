import 'server-only';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { DomainError } from './requests';
import type { CommandActor } from './commands';

export function builderOrigin(): string {
  if (process.env.TOURNAMENT_BUILDER_ENABLED !== 'true') throw new DomainError('NOT_FOUND', 'Tournament builder is not available.');
  const value = process.env.APP_ORIGIN;
  if (!value) throw new DomainError('INTERNAL_ERROR', 'The tournament builder origin is not configured.');
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:') throw new DomainError('INTERNAL_ERROR', 'The tournament builder origin is invalid.');
  return value;
}
export async function webContext(request: Request, mutation = false) {
  const origin = builderOrigin();
  if (mutation && request.headers.get('origin') !== origin) throw new DomainError('FORBIDDEN', 'Open Picktennt to submit this action.');
  const session = await createClient();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) throw new DomainError('UNAUTHENTICATED', 'Sign in to Picktennt.');
  const actor: CommandActor = { id: user.id, clientId: 'web' };
  return { actor, db: await createAdminClient(), origin };
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('INVALID_REQUEST', 'Send JSON command data.');
  if (!request.body) throw new DomainError('INVALID_REQUEST', 'Command data is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new DomainError('INVALID_REQUEST', 'Command data exceeds 64 KB.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('INVALID_REQUEST', 'Command data must be valid JSON.');
  } finally { reader.releaseLock(); }
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof DomainError;
  const code = known ? error.code : 'INTERNAL_ERROR';
  const status = code === 'UNAUTHENTICATED' ? 401 : ['FORBIDDEN', 'GRANT_REVOKED'].includes(code) ? 403 : code === 'NOT_FOUND' ? 404 : code === 'INTERNAL_ERROR' ? 500 : ['STALE_REVISION', 'STALE_PREVIEW', 'IDEMPOTENCY_CONFLICT'].includes(code) ? 409 : 400;
  return Response.json({ code, message: known ? error.message : 'The operation could not be completed.', ...(known && error.details ? { details: error.details } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } });
}
