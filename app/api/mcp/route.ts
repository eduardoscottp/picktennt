import { previewCorrection, previewWithdrawal } from '@/lib/tournament-builder/corrections';
import { previewRevision } from '@/lib/tournament-builder/revisions';
import { previewSchedule } from '@/lib/tournament-builder/schedule-preview';
import { createAdminClient } from '@/lib/supabase/server';
import { createOAuthConfig, hashOAuthSecret } from '@/lib/tournament-builder/oauth';
import { handleMcpRequest } from '@/lib/tournament-builder/mcp-http';
import { callRpc, executeCommand, getOperation, getSnapshot, previewTournament } from '@/lib/tournament-builder/repository';
import { mcpError } from '@/lib/tournament-builder/mcp-security';
import { DomainError } from '@/lib/tournament-builder/requests';
import { previewOwnerAction } from '@/lib/tournament-builder/owner-actions';
import type { CommandActor } from '@/lib/tournament-builder/commands';

export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    if (process.env.MCP_ENABLED !== 'true' || process.env.TOURNAMENT_BUILDER_ENABLED !== 'true' || !process.env.APP_ORIGIN) return new Response(null, { status: 404 });
    const config = createOAuthConfig(process.env.APP_ORIGIN);
    const db = await createAdminClient();
    const authorizedSnapshot = async (actor: CommandActor, id: string, ownerOnly = false) => {
      const snapshot = await getSnapshot(db, actor, id);
      if (ownerOnly ? snapshot.event?.created_by !== actor.id : !['owner', 'admin'].includes(snapshot.caller_role)) throw new DomainError('FORBIDDEN', ownerOnly ? 'Current tournament owner access is required.' : 'Current tournament administrator access is required.');
      return snapshot;
    };
    const findPlayer = async (actor: CommandActor, id: string, username: string, ownerOnly = false) => {
      await authorizedSnapshot(actor, id, ownerOnly);
      const { data, error } = await db.from('profiles').select('id,first_name,last_name,username').eq('username', username).maybeSingle();
      if (error) throw new DomainError('INTERNAL_ERROR', 'Player lookup is unavailable.');
      if (!data) throw new DomainError('NOT_FOUND', 'No Picktennt player has that username.');
      return { id: data.id, username: data.username, display_name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username };
    };
    return await handleMcpRequest(request, {
      config,
      verifyToken: (hash, resource) => callRpc(db, 'tb_oauth_store', { p_action: 'verify_token', p_payload: { token_hash: hash, resource } }),
      // The existing persistent limiter gives each account its own MCP bucket,
      // independent of source IP and the OAuth token endpoint's keys.
      rateLimit: actorId => callRpc(db, 'tb_oauth_store', { p_action: 'rate_limit', p_payload: { bucket: 'token', key_hash: hashOAuthSecret(`mcp:user:${actorId}`) } }),
      forActor: actor => ({
        ...(actor.permissions?.includes('player:manage') ? { player: { snapshot: (id:string) => getSnapshot(db,actor,id) } } : {}),
        ...(actor.permissions?.includes('admin:manage') ? { admin: {
          snapshot: (id:string) => authorizedSnapshot(actor,id),
          findPlayer: (id:string,username:string) => findPlayer(actor,id,username),
          previewCorrection: async (id:string,data:Record<string,unknown>) => { const snapshot=await getSnapshot(db,actor,id); return previewCorrection(snapshot,{...actor,role:snapshot.caller_role==='admin'?'admin':'player'},data); },
          previewWithdrawal: async (id:string,data:Record<string,unknown>) => { const snapshot=await getSnapshot(db,actor,id); return previewWithdrawal(snapshot,{...actor,role:snapshot.caller_role==='admin'?'admin':'player'},data); },
          previewRevision: async (id:string,data:Record<string,unknown>) => { const snapshot=await getSnapshot(db,actor,id); return previewRevision(snapshot,{...actor,role:snapshot.caller_role==='admin'?'admin':'player'},data); },
          previewSchedule: async (id:string,data:Record<string,unknown>) => { const snapshot=await getSnapshot(db,actor,id); return previewSchedule(snapshot,{...actor,role:snapshot.caller_role==='admin'?'admin':'player'},data); },
        }} : {}),
        ...(actor.permissions?.includes('owner:manage') ? { owner: {
          snapshot: (id:string) => authorizedSnapshot(actor,id,true),
          findPlayer: (id:string,username:string) => findPlayer(actor,id,username,true),
          previewAction: async (id,action,data) => previewOwnerAction(await authorizedSnapshot(actor,id,true),actor,action,data),
        }} : {}),
        execute: (command, id, input) => executeCommand(db, actor, command, id, input),
        getDraft: async id => {
          const snapshot = await getSnapshot(db, actor, id);
          const saved = snapshot.definitions.find(row => row.id === snapshot.event?.definition_id);
          if (!saved) throw new DomainError('NOT_FOUND', 'Draft not found.');
          return { tournament_id: id, revision: snapshot.event?.revision, status: snapshot.event?.modular_state, definition: saved.definition };
        },
        preview: id => previewTournament(db, actor, id),
        operation: async (id, operationId) => {
          const receipt = await getOperation(db, actor, operationId);
          if (receipt.tournament_id !== id) throw new DomainError('NOT_FOUND', 'Operation not found.');
          return receipt;
        },
        reviewLink: async id => {
          const snapshot = await getSnapshot(db, actor, id);
          return { tournament_id: id, revision: snapshot.event?.revision, review_url: `${config.issuer}/tournaments/${id}/builder`, publication_requires_owner_review: true };
        },
      }),
    });
  } catch (error) { return Response.json(mcpError(error), { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;

