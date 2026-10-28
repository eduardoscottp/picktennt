import { webContext, readJson, errorResponse } from '@/lib/tournament-builder/http';
import { getSnapshot } from '@/lib/tournament-builder/repository';
import { previewOwnerAction } from '@/lib/tournament-builder/owner-actions';
import { DomainError, UUID } from '@/lib/tournament-builder/requests';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) throw new DomainError('INVALID_REQUEST', 'A tournament UUID is required.');
    const { db, actor } = await webContext(request, true);
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError('INVALID_REQUEST', 'Provide the proposed owner action.');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['action', 'data'].includes(key)) || typeof input.action !== 'string' || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new DomainError('INVALID_REQUEST', 'Provide action and data.');
    const snapshot = await getSnapshot(db, actor, id);
    return Response.json(previewOwnerAction(snapshot, actor, input.action, input.data as Record<string, unknown>), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
