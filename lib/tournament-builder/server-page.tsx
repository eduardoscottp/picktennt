import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { TournamentBuilder } from '@/components/tournament-builder/builder';
import { getSnapshot } from './repository';
import { previewDefinition } from './preview';
import { canonicalTournamentPath, type TournamentView } from './navigation';
import { loadTournamentPage } from './page-loader';
import { UUID } from './requests';

async function lookupTournament(id: string) {
  const db = await createAdminClient();
  const { data, error } = await db.from('tournaments').select('engine_version,modular_state').eq('id', id).maybeSingle();
  // An unavailable engine probe must never send a modular event through legacy writers.
  if (error) throw new Error('Could not load this tournament.');
  return data;
}

/** Null means the caller should continue its existing legacy page unchanged. */
export async function modularTournamentPage(id: string, view: TournamentView) {
  const result = await loadTournamentPage(id, view, {
    enabled: process.env.TOURNAMENT_BUILDER_ENABLED === 'true',
    lookupEngine: async eventId => (await lookupTournament(eventId))?.engine_version ?? null,
    currentUser: async () => {
      const session = await createClient();
      const { data: { user }, error } = await session.auth.getUser();
      return error ? null : user;
    },
    getSnapshot: async (eventId, actorId) => getSnapshot(await createAdminClient(), { id: actorId, clientId: 'web' }, eventId),
  });
  if (result.kind === 'legacy') return null;
  if (result.kind === 'not_found') notFound();
  if (result.kind === 'redirect') redirect(result.location);
  if (result.kind !== 'render') return null;
  const { snapshot } = result;
  const definition = snapshot.definitions.find(row => row.id === snapshot.event?.definition_id) ?? snapshot.definitions.at(-1);
  const preview = previewDefinition(definition?.definition ?? {}, Number(snapshot.event!.revision));
  return <TournamentBuilder actorId={result.actorId} initialSnapshot={snapshot} initialPreview={preview} view={result.view} />;
}

/** Modular join links only navigate to consent UI; legacy join retains its existing flow. */
export async function redirectModularJoin(id: string) {
  if (!UUID.test(id)) notFound();
  const tournament = await lookupTournament(id);
  if (tournament?.engine_version !== 'modular_v1') return;
  if (process.env.TOURNAMENT_BUILDER_ENABLED !== 'true') notFound();
  redirect(canonicalTournamentPath(id, String(tournament.modular_state)));
}
