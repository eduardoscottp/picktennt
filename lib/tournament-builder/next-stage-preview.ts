import type { CommandActor, CommandSnapshot, StorageRow } from './commands';
import { entryPlayerIds } from './entry-roster';
import { isEligibleEntry } from './disciplinary-eligibility';
import { resolvedDefinition } from './resolved-definition';
import { analyzeTournament } from './runtime';
import { generateRoundRobin } from './modules/round-robin';
import { definitionHash, DomainError } from './requests';
import type { FixtureResult, RuntimeOptions } from './types';
import { validateDraft } from './validate';
import { previewGraphNextStage } from './graph-next-stage-preview';

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Detect partial or duplicated existing brackets without recreating any games. */
export function inspectV1Bracket(nodeId: string, count: 2 | 4, bronze: boolean, matches: readonly StorageRow[]) {
  const keys = count === 2 ? [`${nodeId}:r1:m1`] : [`${nodeId}:r1:m1`, `${nodeId}:r1:m2`, `${nodeId}:r2:m1`, ...(bronze ? [`${nodeId}:bronze`] : [])];
  const missing = keys.filter(key => matches.filter(match => match.logical_key === key).length === 0).length;
  const inconsistent = matches.length !== keys.length || keys.some(key => matches.filter(match => match.logical_key === key).length !== 1);
  return { missing, inconsistent };
}

/** Read-only review of a v1 round robin and its configured knockout. */
export function previewNextStage(snapshot: CommandSnapshot, actor: CommandActor) {
  if (!snapshot.event || (snapshot.event.created_by !== actor.id && actor.role !== 'admin')) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (actor.clientId !== 'web' && !actor.permissions?.includes('admin:manage')) throw new DomainError('FORBIDDEN', 'Administrator permission required.');
  if (!['ready', 'active', 'completed'].includes(String(snapshot.event.modular_state))) throw new DomainError('INVALID_STATE', 'The tournament roster must be locked first.');
  if (snapshot.event.results_under_review === true) throw new DomainError('INVALID_STATE', 'Resolve the results under review before generating another stage.');
  const definition = validateDraft(resolvedDefinition(snapshot)?.definition, { registration: true }).definition;
  if (!definition) throw new DomainError('UNSUPPORTED_FORMAT', 'This format requires a separate stage review.');
  if (definition.schema_version === '2.0') return previewGraphNextStage(snapshot, actor, definition);
  const rr = definition.nodes.find(node => node.module === 'round_robin@1');
  if (!rr) throw new DomainError('UNSUPPORTED_FORMAT', 'This format has no round robin to review.');
  const stages = snapshot.stages.filter(stage => !stage.definition_id || stage.definition_id === snapshot.event?.definition_id);
  const roster = stages.find(stage => stage.module_id === 'entries');
  const rosterOutput = object(roster?.output);
  const ids = rosterOutput.entryIds;
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new DomainError('INVALID_STATE', 'The tournament roster must be locked first.');
  const entries = ids.map(id => ({ id, playerIds: entryPlayerIds(snapshot, id) }));
  const rrStage = stages.find(stage => stage.node_id === rr.id);
  const rankingStage = stages.find(stage => stage.module_id === 'standings');
  if (!rrStage || !rankingStage) throw new DomainError('INVALID_STATE', 'The round robin stages are unavailable.');
  const matches = snapshot.matches.filter(match => match.is_current !== false && !match.voided_at);
  const expected = generateRoundRobin(entries, definition.event.courts, rr.id, true);
  const previous = matches.filter(match => match.stage_id === rrStage.id);
  const missing = expected.filter(fixture => previous.filter(match => match.logical_key === fixture.id).length !== 1).length;
  const pending = previous.filter(match => !['validated', 'walkover'].includes(String(match.status)) || !match.outcome_kind).length;
  const elimination = definition.nodes.find(node => node.module === 'elimination@1');
  const qualification = definition.nodes.find(node => node.module === 'qualify@1');
  const eliminationStage = stages.find(stage => stage.node_id === elimination?.id);
  if (elimination && !eliminationStage) throw new DomainError('INVALID_STATE', 'The elimination stage is unavailable.');
  const existing = eliminationStage ? matches.filter(match => match.stage_id === eliminationStage.id) : [];
  const base = { event_revision: Number(snapshot.event.revision), missing_matches: missing, pending_results: pending };
  if (missing || pending) return { ...base, state: 'blocked' as const, reason: 'RESULTS_INCOMPLETE' as const, fixtures: [] };
  if (existing.length) {
    if (elimination?.module === 'elimination@1' && qualification?.module === 'qualify@1') {
      const integrity = inspectV1Bracket(elimination.id, qualification.config.count, elimination.config.bronze, existing);
      if (integrity.inconsistent) return { ...base, missing_matches: integrity.missing, state: 'blocked' as const, reason: 'SCHEDULE_INCONSISTENT' as const, fixtures: [] };
    }
    return { ...base, state: 'existing' as const, fixtures: [] };
  }
  const inputRevision = Math.max(0, ...previous.map(match => Number(match.result_revision ?? 0)));
  const rankingOutput = object(rankingStage.output);
  const options: RuntimeOptions = { allowIncompleteRoster: true, rosterRevision: Number(snapshot.event.roster_revision), inputRevision,
    eligibleEntryIds: snapshot.teams.filter(team => ids.includes(team.id) && isEligibleEntry(snapshot, team)).map(team => team.id),
    rankingDraws: rankingOutput.rankingDraws as RuntimeOptions['rankingDraws'],
    roundRobinExclusions: rosterOutput.roundRobinExclusions as string[] | undefined,
    lockedQualifierIds: rosterOutput.qualifierSlots as RuntimeOptions['lockedQualifierIds'] };
  const results: FixtureResult[] = previous.filter(match => match.logical_key).map(match => ({ fixtureId: String(match.logical_key), accepted: true, outcome: match.outcome_kind as FixtureResult['outcome'], winnerEntryId: match.winner_team_id as string | null, scoreA: match.score_a as number | null, scoreB: match.score_b as number | null }));
  if (rosterOutput.qualificationUnderReview) {
    const candidate = analyzeTournament(definition, entries, results, { ...options, lockedQualifierIds: undefined });
    if (candidate.blockedCode === 'UNRESOLVED_TIE') return { ...base, state: 'blocked' as const, reason: candidate.blockedCode, fixtures: [] };
    options.lockedQualifierIds = candidate.qualifiers;
  }
  const automatic = new Map<string, { outcome: 'walkover' | 'no_contest'; winner: string | null; entryA: string | null; entryB: string | null }>();
  let analysis = analyzeTournament(definition, entries, results, options);
  // Match syncRuntime's bounded replay: each pass records only outcomes forced by an empty slot.
  for (let iteration = 0; iteration < 16; iteration++) {
    const forced = (analysis.bracket?.fixtures ?? []).filter(fixture => fixture.state === 'ready' && fixture.requiredOutcome);
    if (!forced.length) break;
    for (const fixture of forced) {
      const outcome = fixture.requiredOutcome!;
      const winner = outcome === 'walkover' ? fixture.entryA ?? fixture.entryB ?? null : null;
      automatic.set(fixture.fixture.id, { outcome, winner, entryA: fixture.entryA ?? null, entryB: fixture.entryB ?? null });
      results.push({ fixtureId: fixture.fixture.id, accepted: true, outcome, winnerEntryId: winner, scoreA: null, scoreB: null });
    }
    analysis = analyzeTournament(definition, entries, results, options);
    if (iteration === 15 && (analysis.bracket?.fixtures ?? []).some(fixture => fixture.state === 'ready' && fixture.requiredOutcome)) throw new DomainError('INVALID_STATE', 'The next stage could not be reviewed.');
  }
  if (analysis.blockedCode) return { ...base, state: 'blocked' as const, reason: analysis.blockedCode, fixtures: [] };
  if (!elimination) return { ...base, state: 'finished' as const, fixtures: [] };
  const fixtures = (analysis.bracket?.fixtures ?? []).map(resolved => {
    const forced = automatic.get(resolved.fixture.id);
    return { ...resolved.fixture, resolved_entry_a: forced ? forced.entryA : resolved.entryA ?? null,
      resolved_entry_b: forced ? forced.entryB : resolved.entryB ?? null,
      automatic_outcome: forced?.outcome ?? null, automatic_winner_entry_id: forced?.winner ?? null };
  });
  const review = { ...base, state: 'ready' as const, fixtures };
  return { ...review, preview_hash: definitionHash({ tournament_id: snapshot.event.id, ...review }) };
}
