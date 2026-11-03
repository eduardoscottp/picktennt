export type TournamentView = 'builder' | 'overview' | 'matches' | 'standings' | 'admin';
export function tournamentPath(id: string, view: TournamentView): string {
  const suffix = { builder: '/builder', overview: '', matches: '/matches', standings: '/leaderboard', admin: '/admin' }[view];
  return `/tournaments/${id}${suffix}`;
}
export function canonicalTournamentPath(id: string, state: string): string {
  return tournamentPath(id, state === 'draft' ? 'builder' : 'overview');
}
