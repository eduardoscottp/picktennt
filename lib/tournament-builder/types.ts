import type { OutcomeKind, StandingRow } from './policies';

export interface TournamentEntry { id: string; playerIds: readonly string[] }
export function assertValidRoster(entries: readonly TournamentEntry[], courts: number): void {
  if (!Number.isInteger(courts) || courts < 1 || courts > 8) throw new Error('Courts must be an integer from 1 to 8.');
  if (entries.length < 2 || entries.length > 16) throw new Error('Roster must contain 2–16 entries.');
  const ids = new Set<string>(), players = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id) || entry.playerIds.length < 1 || entry.playerIds.length > 2) throw new Error('Entries require unique IDs and one or two players.');
    ids.add(entry.id);
    for (const player of entry.playerIds) {
      if (!player || players.has(player)) throw new Error('Each player must belong to exactly one entry.');
      players.add(player);
    }
  }
}
export type FixtureSlot = { kind: 'entry'; entryId: string } | { kind: 'winner' | 'loser'; fixtureId: string };
export interface Fixture { id: string; stageId: string; round: number; wave: number; court: number; a: FixtureSlot; b: FixtureSlot; bronze?: boolean }
/** Current, non-void outcomes only; the command layer owns event/revision/acceptance authority. */
export interface FixtureResult { fixtureId: string; accepted: boolean; outcome: OutcomeKind; winnerEntryId?: string | null; scoreA?: number | null; scoreB?: number | null }
export type StageState = 'waiting' | 'ready' | 'completed' | 'blocked';
export interface ResolvedFixture {
  fixture: Fixture; state: StageState; entryA: string | null | undefined; entryB: string | null | undefined;
  winnerEntryId?: string | null; loserEntryId?: string | null; result?: FixtureResult;
  requiredOutcome?: 'walkover' | 'no_contest';
}
export interface BracketResolution { state: StageState; fixtures: ResolvedFixture[]; eligibleEntryIds: readonly string[] }
export interface PlacementGroup { rank: number; entryIds: string[] }
export interface PlacementResult { state: StageState; groups?: PlacementGroup[]; championEntryId?: string; ineligibleEntryIds?: string[]; unplacedEntryIds?: string[]; blockedCode?: 'UNRESOLVED_TIE' | 'NO_ELIGIBLE_CHAMPION' }
/** Draw revisions must be checked against the current input, never recycled after changed results/roster. */
export interface RuntimeOptions {
  inputRevision?: number; rosterRevision?: number;
  rankingDraws?: readonly { inputRevision: number; entryIds: readonly string[] }[];
  directDraw?: { rosterRevision: number; entryIds: readonly string[] };
  eligibleEntryIds?: readonly string[];
  /** Persist at bracket materialization; after any playoff starts this order must remain pinned. */
  lockedQualifierIds?: readonly string[];
  playoffsStarted?: boolean;
  /** Exclude all pair results for these entries only when withdrawal preceded RR completion. */
  roundRobinExclusions?: readonly string[];
}
export interface TournamentAnalysis {
  state: StageState; blockedCode?: 'INVALID_CAPACITY' | 'DRAW_REQUIRED' | 'UNRESOLVED_TIE' | 'NO_ELIGIBLE_CHAMPION' | 'INVALID_ADVANCEMENT';
  fixtures: Fixture[]; standings: StandingRow[]; ties: string[][]; qualifiers: string[];
  bracket?: BracketResolution; placements?: PlacementResult;
}
