import type { CommandSnapshot } from './commands';
import { DomainError, UUID } from './requests';
import { canonicalTournamentPath, tournamentPath, type TournamentView } from './navigation';

type AuthorizedSnapshot = CommandSnapshot & { caller_role: string };
export interface TournamentPageDependencies {
  enabled: boolean;
  lookupEngine(id: string): Promise<string | null>;
  currentUser(): Promise<{ id: string } | null>;
  getSnapshot(id: string, actorId: string): Promise<AuthorizedSnapshot>;
}
type PageResult = { kind: 'legacy' | 'not_found' } | { kind: 'redirect'; location: string } | { kind: 'render'; view: TournamentView; actorId: string; snapshot: AuthorizedSnapshot };

/** Used by the server page dispatch; no legacy rendering or writes occur on modular paths. */
export async function loadTournamentPage(id: string, view: TournamentView, dependencies: TournamentPageDependencies): Promise<PageResult> {
  if (!UUID.test(id)) return { kind: 'not_found' };
  const engine = await dependencies.lookupEngine(id);
  if (engine !== 'modular_v1') return view === 'builder' ? engine ? { kind: 'redirect', location: tournamentPath(id, 'overview') } : { kind: 'not_found' } : { kind: 'legacy' };
  if (!dependencies.enabled) return { kind: 'not_found' };
  const user = await dependencies.currentUser();
  if (!user) return { kind: 'redirect', location: `/login?redirect=${encodeURIComponent(tournamentPath(id, view))}` };
  let snapshot: AuthorizedSnapshot;
  try { snapshot = await dependencies.getSnapshot(id, user.id); }
  catch (error) {
    if (error instanceof DomainError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return { kind: 'not_found' };
    throw error;
  }
  if (!snapshot.event) return { kind: 'not_found' };
  if (view === 'admin' && snapshot.event.created_by !== user.id && snapshot.caller_role !== 'admin') return { kind: 'not_found' };
  const draft = snapshot.event.modular_state === 'draft';
  if ((draft && view !== 'builder') || (!draft && view === 'builder')) return { kind: 'redirect', location: canonicalTournamentPath(id, String(snapshot.event.modular_state)) };
  return { kind: 'render', view, actorId: user.id, snapshot };
}
