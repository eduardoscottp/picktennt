import { errorResponse, readJson, webContext } from '@/lib/tournament-builder/http';
import { playerSearchFilter, requirePlayerSearchAdmin } from '@/lib/tournament-builder/player-search';
import { getSnapshot } from '@/lib/tournament-builder/repository';
import { DomainError, UUID } from '@/lib/tournament-builder/requests';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) throw new DomainError('INVALID_REQUEST', 'A tournament UUID is required.');
    const { actor, db } = await webContext(request, true);
    const snapshot = await getSnapshot(db, actor, id);
    requirePlayerSearchAdmin(snapshot.caller_role);
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'query') || typeof (body as Record<string, unknown>).query !== 'string') throw new DomainError('INVALID_REQUEST', 'Enter a player name, email, username or DUPR ID.');
    const filter = playerSearchFilter((body as { query: string }).query);
    const { data, error } = await db.from('profiles').select('id,first_name,last_name,username').or(filter).order('first_name').limit(10);
    if (error) throw new DomainError('INTERNAL_ERROR', 'Player search is unavailable.');
    return Response.json({ players: (data ?? []).map(profile => ({ id: profile.id, username: profile.username, display_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || 'Picktennt player' })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
