import { webContext, readJson, errorResponse } from '@/lib/tournament-builder/http';
import { DomainError } from '@/lib/tournament-builder/requests';

export async function POST(request: Request) {
  try {
    const { db } = await webContext(request, true);
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'username')) throw new DomainError('INVALID_REQUEST', 'Provide a Picktennt username.');
    const username = (body as Record<string, unknown>).username;
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) throw new DomainError('INVALID_REQUEST', 'Enter the exact Picktennt username.');
    const { data, error } = await db.from('profiles').select('id,first_name,last_name,username').eq('username', username.toLowerCase()).maybeSingle();
    if (error) throw new DomainError('INTERNAL_ERROR', 'Player lookup is unavailable.');
    if (!data) throw new DomainError('NOT_FOUND', 'No player has that username.');
    return Response.json({ id: data.id, display_name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
