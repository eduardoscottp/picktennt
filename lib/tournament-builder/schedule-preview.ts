import { planCommand, type CommandActor, type CommandSnapshot } from './commands';
import { definitionHash } from './requests';
import { entryPlayerIds } from './entry-roster';
import { resolvedDefinition } from './resolved-definition';
import { summarizeScheduleFairness } from './fair-scheduling';
import type { Fixture, ResolvedFixture } from './types';

/** Stable order binds preview and generation to the same roster revision. */
export function generationOrder(s: CommandSnapshot, ids: readonly string[]): string[] {
  const key = (id: string) => definitionHash([s.event!.id, s.event!.revision, s.event!.roster_revision, id]);
  return [...ids].sort((a, b) => key(a).localeCompare(key(b)));
}
export function previewSchedule(s: CommandSnapshot, actor: CommandActor, data: Record<string, unknown>, now = new Date().toISOString()) {
  const request = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'preview_hash'));
  let sequence = 0;
  const plan = planCommand(s, actor, 'lockRoster', request, { now, draw: ids => generationOrder(s, ids), id: () => {
    const h = definitionHash([s.event!.id, s.event!.revision, ++sequence]);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  } });
  const matches = plan.effects.matches ?? [], rounds = plan.effects.rounds ?? [], stages = [...s.stages, ...(plan.effects.stages ?? [])];
  const fixtures: Fixture[] = matches.filter(m => m.is_current !== false && m.logical_key).map(m => {
    const round = rounds.find(r => r.id === m.round_id), stage = stages.find(st => st.id === m.stage_id);
    const side = (team: unknown, which: 'a' | 'b'): Fixture['a'] => {
      if (typeof team === 'string') return { kind: 'entry', entryId: team };
      const winner = matches.find(f => f.bracket_next_winner_match_id === m.id && f.bracket_winner_fills_side === which);
      const loser = matches.find(f => f.bracket_next_loser_match_id === m.id && f.bracket_loser_fills_side === which);
      return winner ? { kind: 'winner', fixtureId: String(winner.logical_key) } : loser ? { kind: 'loser', fixtureId: String(loser.logical_key) } : { kind: 'entry', entryId: '' };
    };
    return { id: String(m.logical_key), stageId: String(stage?.node_id ?? m.stage_id), round: Number(String(m.logical_key).match(/:r(\d+):/)?.[1] ?? 1), wave: Number(round?.logical_wave ?? 1), court: Number(m.court_number), a: side(m.team_a_id, 'a'), b: side(m.team_b_id, 'b') };
  }).sort((a, b) => a.wave - b.wave || a.court - b.court || a.id.localeCompare(b.id));
  const concrete: ResolvedFixture[] = fixtures.map(f => ({ fixture: f, state: 'ready', entryA: f.a.kind === 'entry' ? f.a.entryId || null : null, entryB: f.b.kind === 'entry' ? f.b.entryId || null : null }));
  const entries = s.teams.filter(t => t.entry_state === 'approved').map(t => ({ id: t.id, playerIds: entryPlayerIds(s, t.id) }));
  const fairness = summarizeScheduleFairness(entries, concrete);
  const warnings: string[] = [];
  if (new Set(fairness.map(f => f.games)).size > 1) warnings.push('Teams have unequal guaranteed game counts. Review group sizes and the format before confirming.');
  if (concrete.some(f => !f.entryA || !f.entryB)) warnings.push('Knockout participants depend on results. Waiting metrics cover currently known pairings only.');
  warnings.push('Slot estimates do not guarantee equal playing minutes in score-based games.');
  const definition = resolvedDefinition(s)?.definition as { scheduling: { estimated_slot_minutes: number } };
  const payload = { event_revision: Number(s.event!.revision), fixtures, fairness, warnings, estimated_slot_minutes: definition.scheduling.estimated_slot_minutes };
  return { ...payload, preview_hash: definitionHash({ tournament_id: s.event!.id, request, ...payload }) };
}
