import { webContext, readJson, errorResponse } from '@/lib/tournament-builder/http';
import { executeCommand } from '@/lib/tournament-builder/repository';

export async function POST(request: Request) {
  try {
    const { db, actor } = await webContext(request, true);
    const receipt = await executeCommand(db, actor, 'createDraft', null, await readJson(request));
    return Response.json(receipt, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
