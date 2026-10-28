import { webContext, readJson, errorResponse } from '@/lib/tournament-builder/http';
import { executeCommand, getOperation, getSnapshot } from '@/lib/tournament-builder/repository';
import { DomainError, UUID } from '@/lib/tournament-builder/requests';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { db, actor } = await webContext(request, true);
    const command = new URL(request.url).searchParams.get('command');
    if (!UUID.test(id) || !command) throw new DomainError('INVALID_REQUEST', 'A tournament and command are required.');
    return Response.json(await executeCommand(db, actor, command, id, await readJson(request)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { db, actor } = await webContext(request);
    const operationId = new URL(request.url).searchParams.get('operation_id');
    if (!operationId || !UUID.test(operationId)) throw new DomainError('INVALID_REQUEST', 'An operation UUID is required.');
    await getSnapshot(db, actor, id);
    let receipt;
    try { receipt = await getOperation(db, actor, operationId); }
    catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') return Response.json(null, { headers: { 'Cache-Control': 'no-store' } });
      throw error;
    }
    if (!receipt) return Response.json(null, { headers: { 'Cache-Control': 'no-store' } });
    if (receipt.tournament_id !== id) throw new DomainError('NOT_FOUND', 'Operation not found.');
    return Response.json(receipt, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
