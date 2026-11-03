import { webContext, readJson, errorResponse } from '@/lib/tournament-builder/http';
import { getSnapshot } from '@/lib/tournament-builder/repository';
import { previewCorrection, previewWithdrawal } from '@/lib/tournament-builder/corrections';
import { DomainError, UUID } from '@/lib/tournament-builder/requests';
import type { CommandActor } from '@/lib/tournament-builder/commands';
import { previewRevision } from '@/lib/tournament-builder/revisions';
import { previewSchedule } from '@/lib/tournament-builder/schedule-preview';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) throw new DomainError('INVALID_REQUEST', 'A tournament UUID is required.');
    const { db, actor } = await webContext(request, true);
    const snapshot = await getSnapshot(db, actor, id);
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError('INVALID_REQUEST', 'Provide the proposed change.');
    const verifiedActor: CommandActor = { ...actor, role: snapshot.caller_role === 'owner' || snapshot.caller_role === 'admin' ? snapshot.caller_role : 'player' };
    const kind = new URL(request.url).searchParams.get('kind');
    const preview = kind === 'correction' ? previewCorrection(snapshot, verifiedActor, body as Record<string, unknown>) :
      kind === 'withdrawal' ? previewWithdrawal(snapshot, verifiedActor, body as Record<string, unknown>) :
      kind === 'revision' ? previewRevision(snapshot, verifiedActor, body as Record<string, unknown>) :
      kind === 'schedule' ? previewSchedule(snapshot, verifiedActor, body as Record<string, unknown>) : null;
    if (!preview) throw new DomainError('INVALID_REQUEST', 'Choose a correction, withdrawal, revision or schedule preview.');
    return Response.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
