import { webContext, errorResponse } from '@/lib/tournament-builder/http';
import { getSnapshot } from '@/lib/tournament-builder/repository';
import { previewDefinition } from '@/lib/tournament-builder/preview';
import { DomainError, UUID } from '@/lib/tournament-builder/requests';
import { resolvedDefinition } from '@/lib/tournament-builder/resolved-definition';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) throw new DomainError('INVALID_REQUEST', 'A tournament UUID is required.');
    const { db, actor } = await webContext(request);
    const snapshot = await getSnapshot(db, actor, id);
    const definition = resolvedDefinition(snapshot);
    const preview = previewDefinition(definition?.definition ?? {}, Number(snapshot.event?.revision ?? 0));
    return Response.json({ snapshot, preview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
