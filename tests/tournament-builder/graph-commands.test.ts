import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planCommand, type CommandSnapshot, type CommandPlan, type CommandActor } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { previewBulkAdjudication } from '../../lib/tournament-builder/bulk-adjudication-preview';
import { previewBulkOperation } from '../../lib/tournament-builder/bulk-adjudication';
import { callTournamentTool, type McpDependencies } from '../../lib/tournament-builder/mcp';
import { planForcedPendingMatch, previewForcedPendingMatch } from '../../lib/tournament-builder/force-pending-match';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import { entryPlayerIds } from '../../lib/tournament-builder/entry-roster';
import { resolvedDefinition } from '../../lib/tournament-builder/resolved-definition';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

const id = () => crypto.randomUUID();
const owner: CommandActor = { id: id(), clientId: 'web', role: 'owner' };
const context = { now: '2026-10-28T16:00:00Z', id, draw: (ids: readonly string[]) => [...ids] };
const empty = (): CommandSnapshot => ({ event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] });
function apply(s: CommandSnapshot, p: CommandPlan) {
  const next = structuredClone(s);
  next.event = { id: next.event?.id ?? id(), created_by: owner.id, revision: 0, roster_revision: 0, result_version: 0, ...next.event, ...p.effects.event };
  next.event.revision = Number(next.event.revision) + 1;
  if (p.effects.definition) {
    const old = next.definitions.findIndex(d => d.id === p.effects.definition!.id);
    if (old < 0) next.definitions.push(p.effects.definition); else next.definitions[old] = { ...next.definitions[old], ...p.effects.definition };
  }
  for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) for (const patch of p.effects[table] ?? []) {
    const old = next[table].findIndex(row => row.id === patch.id);
    if (old < 0) next[table].push(patch); else next[table][old] = { ...next[table][old], ...patch };
  }
  return next;
}
function execute(s: CommandSnapshot, command: string, data = {}, actor = owner) { return apply(s, planCommand(s, actor, command, data, context)); }
export function activeGroups(d = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'))) {
  d = structuredClone(d); d.registration.mode = 'open';
  const preview = previewDefinition(d, 1);
  let s = execute(empty(), 'createDraft', { definition: d });
  s = execute(s, 'publishTournament', { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes });
  for (let i = 0; i < d.registration.max_entries; i++) {
    const players = [id(), id()];
    for (const userId of players) s = execute(s, 'joinTournament', { definition_id: s.event!.definition_id, consent: true }, { id: userId, clientId: 'web', role: 'player' });
    s = execute(s, 'addRegisteredEntry', { definition_id: s.event!.definition_id, player_ids: players, entry_name: `Team ${i + 1}`, reason: 'Organizer placement of joined players' });
  }
  s = execute(s, 'closeRegistration');
  s = execute(s, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision });
  return execute(s, 'startTournament');
}
function score(s: CommandSnapshot, matchId: string) {
  const row = s.matches.find(m => m.id === matchId)!;
  const a = Number(s.teams.find(t => t.id === row.team_a_id)!.seed), b = Number(s.teams.find(t => t.id === row.team_b_id)!.seed);
  return execute(s, 'attestScore', { match_id: matchId, score_a: a < b ? 11 : 2, score_b: a < b ? 2 : 11, reason: 'Verified result' });
}

test('graph runtime keeps previous results and allows a walkover when an active team has an empty roster', () => {
  let s = activeGroups();
  const first = s.matches.find(match => match.team_a_id && match.team_b_id)!;
  const teamId = first.team_a_id;
  s = score(s, first.id);
  const saved = structuredClone(s.matches.find(match => match.id === first.id)!);
  for (const member of s.team_members.filter(member => member.team_id === teamId)) member.membership_status = 'cancelled';
  const definition = resolvedDefinition(s)!.definition as GraphDefinition;
  const roster = s.teams.filter(team => team.entry_state === 'approved').map(team => ({ id: team.id, playerIds: entryPlayerIds(s, team.id) }));
  assert.equal(analyzeGraph(definition, roster, []).blockedCode, 'INVALID_CAPACITY');
  const analysis = analyzeGraph(definition, roster, [], { allowIncompleteRoster: true });
  const teamGames = analysis.fixtures.filter(match => [match.a, match.b].some(slot => slot.kind === 'entry' && slot.entryId === teamId));
  assert.equal(new Set(teamGames.map(match => match.wave)).size, teamGames.length);
  const pending = s.matches.find(match => match.status === 'scheduled' && (match.team_a_id === teamId || match.team_b_id === teamId) && match.team_a_id && match.team_b_id)!;
  assert.throws(() => planCommand(s, owner, 'startMatch', { match_id: pending.id }, context), { code: 'INCOMPLETE_ROSTER' });
  const opponent = pending.team_a_id === teamId ? pending.team_b_id : pending.team_a_id;
  s = execute(s, 'attestScore', { match_id: pending.id, outcome_kind: 'walkover', winner_entry_id: opponent, reason: 'Opponent absent' });
  assert.equal(s.matches.find(match => match.id === pending.id)!.outcome_kind, 'walkover');
  assert.equal(s.matches.find(match => match.id === first.id)!.score_a, saved.score_a);
  assert.equal(s.matches.find(match => match.id === first.id)!.score_b, saved.score_b);
});

test('forcing a pending terminal match preserves prior results and survives later runtime propagation', () => {
  let s = activeGroups();
  for (const match of s.matches.filter(match => String(match.logical_key).includes(':r'))) s = score(s, match.id);
  for (const match of s.matches.filter(match => ['SF1:match', 'SF2:match'].includes(String(match.logical_key)))) s = score(s, match.id);
  const final = s.matches.find(match => match.logical_key === 'F:match')!;
  const semifinal = s.matches.find(match => match.logical_key === 'SF1:match')!;
  const replaced = semifinal.team_a_id === semifinal.winner_team_id ? semifinal.team_b_id : semifinal.team_a_id;
  const data = { match_id: final.id, team_a_id: replaced, team_b_id: final.team_b_id, reason: 'Replace finalist after review' };
  const before = JSON.stringify(s), review = previewForcedPendingMatch(s, owner, data);
  assert.equal(JSON.stringify(s), before);
  assert.ok(review.detached_feeder_ids.includes(semifinal.id));
  assert.throws(() => planForcedPendingMatch({ ...s, event: { ...s.event!, revision: Number(s.event!.revision) + 1 } }, owner, { ...data, preview_hash: review.preview_hash }), { code: 'STALE_PREVIEW' });
  const saved = structuredClone(semifinal);
  s = apply(s, planForcedPendingMatch(s, owner, { ...data, preview_hash: review.preview_hash }));
  assert.equal(s.matches.find(match => match.id === final.id)!.team_a_id, replaced);
  assert.equal(s.matches.find(match => match.id === semifinal.id)!.score_a, saved.score_a);
  s = score(s, final.id);
  assert.equal(s.matches.find(match => match.id === final.id)!.team_a_id, replaced);
});


test('bulk simulation evaluates selected scores together without changing saved results or accepting provisional scores', () => {
  let s = activeGroups();
  const stage = s.stages.find(stage => stage.node_id === 'A')!;
  const games = s.matches.filter(match => match.stage_id === stage.id);
  const entry = String(games[0].team_a_id);
  const selected = games.filter(match => [match.team_a_id, match.team_b_id].includes(entry)).slice(0, 2);
  s = score(s, selected[0].id);
  const provisional = s.matches.find(match => match.stage_id === stage.id && !selected.some(selectedMatch => selectedMatch.id === match.id))!;
  Object.assign(provisional, { status: 'score_entered', score_a: 11, score_b: 0, winner_team_id: provisional.team_a_id });
  const before = JSON.stringify(s);
  const data = { entry_id: entry, match_ids: selected.map(match => match.id), mode: 'score', winner_score: 11, loser_score: 0 };
  const preview = previewBulkAdjudication(s, owner, data);
  assert.equal(JSON.stringify(s), before);
  assert.equal(preview.complete_impact_preview, false);
  assert.equal(preview.bulk_action_available, false);
  assert.equal(preview.selected_matches[0].before.status, 'validated');
  assert.equal(preview.selected_matches[1].before.status, 'scheduled');
  const row = preview.projected_source_standings[0].rows.find(row => row.entryId === entry)!;
  assert.equal(row.losses, 2);
  assert.equal(row.pointsFor, 0);
  assert.equal(row.pointsAgainst, 22);
  assert.equal(preview.projected_source_standings[0].rows.reduce((total, standing) => total + standing.wins, 0), 2, 'Unconfirmed scores do not enter standings.');
  assert.ok(preview.potentially_affected_match_ids.includes(s.matches.find(match => match.logical_key === 'SF1:match')!.id));
  const walkover = previewBulkAdjudication(s, owner, { entry_id: entry, match_ids: selected.map(match => match.id), mode: 'walkover' });
  const walkoverRow = walkover.projected_source_standings[0].rows.find(row => row.entryId === entry)!;
  assert.equal(walkoverRow.losses, 2);
  assert.equal(walkoverRow.pointsAgainst, 0);
  assert.throws(() => previewBulkAdjudication(s, { id: id(), clientId: 'web', role: 'player' }, data), { code: 'FORBIDDEN' });
  assert.throws(() => previewBulkAdjudication(s, owner, { ...data, match_ids: [selected[0].id, selected[0].id] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => previewBulkAdjudication(s, owner, { ...data, winner_score: 4 }), { code: 'INVALID_SCORE' });
});

test('bulk operation binds one combined preview, recalculates standings and fences stale or unauthorized requests', () => {
  let s = activeGroups();
  const match = s.matches.find(match => match.logical_key === 'A:r1:m1')!;
  s = score(s, match.id);
  const entryId = String(s.matches.find(row => row.id === match.id)!.winner_team_id);
  const proposal = { entry_id: entryId, match_ids: [match.id], mode: 'score', winner_score: 11, loser_score: 0, reason: 'Administrative award', overwrite_existing: true, regenerate_downstream: false };
  const preview = previewBulkOperation(s, owner, proposal);
  const before = JSON.stringify(s);
  const plan = planCommand(s, owner, 'bulkAdjudicate', { ...proposal, preview_hash: preview.preview_hash }, context);
  assert.equal(JSON.stringify(s), before);
  const updated = apply(s, plan);
  const changed = updated.matches.find(row => row.id === match.id)!;
  assert.equal(changed.outcome_kind, 'administrative_score');
  assert.equal(changed.submit_to_dupr, false);
  assert.equal(changed.winner_team_id, entryId === match.team_a_id ? match.team_b_id : match.team_a_id);
  assert.throws(() => planCommand(s, owner, 'bulkAdjudicate', { ...proposal, overwrite_existing: false, preview_hash: preview.preview_hash }, context), { code: 'INVALID_REQUEST' });
  assert.throws(() => planCommand({ ...s, event: { ...s.event!, revision: Number(s.event!.revision) + 1 } }, owner, 'bulkAdjudicate', { ...proposal, preview_hash: preview.preview_hash }, context), { code: 'STALE_PREVIEW' });
  assert.throws(() => previewBulkOperation(s, { id: id(), clientId: 'web', role: 'player' }, proposal), { code: 'FORBIDDEN' });
  const replay = previewBulkOperation(s, owner, { ...proposal, regenerate_downstream: true });
  assert.ok(replay.archived_matches.length > 0);
  const replayed = apply(s, planCommand(s, owner, 'bulkAdjudicate', { ...proposal, regenerate_downstream: true, preview_hash: replay.preview_hash }, context));
  assert.ok(replay.archived_matches.every(old => replayed.matches.find(match => match.id === old.match_id)?.is_current === false));
  assert.ok(replay.changed_fixtures.filter(change => change.new_fixture).every(change => replayed.matches.some(match => match.id === change.match_id && match.is_current !== false)));
});

test('MCP rejects unsupported v1 games and changed dependent pairings', async () => {
  const s = activeGroups();
  const first = s.matches.find(match => match.logical_key === 'A:r1:m1')!;
  const entry = String(first.team_a_id);
  const args = { tournament_id: String(s.event!.id), data: { entry_id: entry, match_ids: [first.id], mode: 'walkover', reason: 'Review', overwrite_existing: false, regenerate_downstream: false } };
  let current = structuredClone(s);
  const deps: McpDependencies = { execute: async () => ({}), getDraft: async () => ({}), preview: async () => ({}), operation: async () => ({}), reviewLink: async () => ({}), admin: { snapshot: async () => current, findPlayer: async () => ({}), previewCorrection: async () => ({}), previewWithdrawal: async () => ({}), previewBulkOperation: async (_id, data) => previewBulkOperation(current, owner, data) } };
  current.definitions.find(definition => definition.id === current.event!.definition_id)!.definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  const v1Elimination = current.matches.find(match => match.logical_key === 'SF1:match')!;
  v1Elimination.team_a_id = entry; v1Elimination.team_b_id = first.team_b_id;
  await assert.rejects(callTournamentTool('admin_preview_bulk_adjudication', { ...args, data: { ...args.data, match_ids: [v1Elimination.id] } }, deps), { code: 'INVALID_STATE' });
  current = structuredClone(s);
  const semifinal = current.matches.find(match => match.logical_key === 'SF1:match')!;
  semifinal.team_a_id = entry;
  semifinal.team_b_id = first.team_b_id;
  await assert.rejects(callTournamentTool('admin_preview_bulk_adjudication', { ...args, data: { ...args.data, match_ids: [first.id, semifinal.id] } }, deps), { code: 'DEPENDENCY_CHANGED' });
  assert.throws(() => planCommand(s, owner, 'internalRuntime', {}, context), { code: 'INVALID_COMMAND' });
});

test('combined dependent stages retain reviewed intermediate results and reject changed participants', () => {
  let s = activeGroups();
  const aStage = s.stages.find(stage => stage.node_id === 'A')!;
  const games = s.matches.filter(match => match.stage_id === aStage.id);
  const teams = s.teams.filter(team => games.some(match => [match.team_a_id, match.team_b_id].includes(team.id))).sort((a,b) => Number(a.seed)-Number(b.seed));
  const entry = teams[0].id, opponent = teams[3].id;
  const upset = games.find(match => [match.team_a_id, match.team_b_id].includes(entry) && [match.team_a_id, match.team_b_id].includes(opponent))!;
  for (const game of s.matches.filter(match => ['A','B','C','D'].includes(String(s.stages.find(stage => stage.id === match.stage_id)?.node_id)))) {
    if (game.id === upset.id) s = execute(s, 'attestScore', { match_id: game.id, score_a: game.team_a_id === opponent ? 11 : 8, score_b: game.team_b_id === opponent ? 11 : 8, reason: 'Observed upset' });
    else s = score(s, game.id);
  }
  for (const nodeId of ['SF1','SF2']) s = score(s, s.matches.find(match => match.logical_key === `${nodeId}:match`)!.id);
  const final = s.matches.find(match => match.logical_key === 'F:match')!;
  assert.ok([final.team_a_id, final.team_b_id].includes(entry));
  const proposal = { entry_id: entry, match_ids: [upset.id, final.id], mode: 'score', winner_score: 11, loser_score: 9, reason: 'Reviewed combined award', overwrite_existing: true, regenerate_downstream: false };
  const preview = previewBulkOperation(s, owner, proposal);
  for (const nodeId of ['SF1','SF2']) assert.ok(preview.preserved_intermediate_matches.some(match => match.id === s.matches.find(row => row.logical_key === `${nodeId}:match`)!.id));
  const after = apply(s, planCommand(s, owner, 'bulkAdjudicate', { ...proposal, preview_hash: preview.preview_hash }, context));
  assert.equal(after.matches.find(match => match.id === final.id)?.outcome_kind, 'administrative_score');
  for (const nodeId of ['SF1','SF2']) assert.equal(after.matches.find(match => match.logical_key === `${nodeId}:match`)?.is_current !== false, true);
  assert.throws(() => previewBulkOperation(s, owner, { ...proposal, loser_score: 0 }), { code: 'DEPENDENCY_CHANGED' });
  assert.throws(() => previewBulkOperation(s, owner, { ...proposal, loser_score: 0, regenerate_downstream: true }), { code: 'DEPENDENCY_CHANGED' });
});

test('commands materialize 27 matches and advance group winners through the final', () => {
  let s = activeGroups();
  assert.equal(s.matches.length, 27);
  assert.equal(s.matches.filter(m => m.team_a_id && m.team_b_id).length, 24);
  assert.throws(() => score(s, s.matches.find(m => m.logical_key === 'SF1:match')!.id));
  while (s.event!.modular_state !== 'completed') {
    const playable = s.matches.find(m => m.status === 'scheduled' && m.team_a_id && m.team_b_id);
    assert.ok(playable, 'The graph must have an eligible next match');
    s = score(s, playable.id);
  }
  const stage = s.stages.find(t => t.module_id === 'placements')!;
  assert.equal(stage.state, 'completed');
  const groups = (stage.output as { groups: { rank: number; entryIds: string[] }[] }).groups;
  assert.equal(groups.find(g => g.rank === 1)!.entryIds[0], s.teams.find(t => t.seed === 1)!.id);
  assert.equal(new Set(groups.flatMap(g => g.entryIds)).size, 16);
  assert.equal(s.standings.length, 16);
  assert.equal(new Set(s.standings.map(row => row.stage_id)).size, 4);
});

test('commands persist cross-play fixtures, standings and top-four advancement', () => {
  const d = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
  d.registration.min_entries = d.registration.max_entries = 8;
  d.nodes = [
    { id: 'registration', module: 'registration@1' },
    { id: 'entries', module: 'entries@1', from: 'registration' },
    { id: 'cross', module: 'cross_play@1', side_a: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })), side_b: [5, 6, 7, 8].map(seed => ({ kind: 'seed', seed })) },
    { id: 'semi1', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'cross', rank: 1 }, { kind: 'rank', node_id: 'cross', rank: 4 }] },
    { id: 'semi2', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'cross', rank: 2 }, { kind: 'rank', node_id: 'cross', rank: 3 }] },
    { id: 'final', module: 'match@1', inputs: [{ kind: 'winner', node_id: 'semi1' }, { kind: 'winner', node_id: 'semi2' }] },
    { id: 'placements', module: 'placements@2', final: 'final' },
  ];
  let s = activeGroups(d);
  assert.equal(s.matches.length, 19);
  const cross = s.stages.find(stage => stage.node_id === 'cross')!;
  assert.equal(s.matches.filter(match => match.stage_id === cross.id).length, 16);
  for (const match of s.matches.filter(match => match.stage_id === cross.id)) s = score(s, match.id);
  for (const tie of ((s.stages.find(stage => stage.id === cross.id)!.output as { ties: string[][] }).ties ?? [])) {
    const ordered = [...tie].sort((a, b) => Number(s.teams.find(team => team.id === a)!.seed) - Number(s.teams.find(team => team.id === b)!.seed));
    const inputRevision = Number((s.stages.find(stage => stage.id === cross.id)!.output as { inputRevision: number }).inputRevision);
    s = execute(s, 'resolveTie', { stage_id: cross.id, input_revision: inputRevision, entry_ids: ordered });
  }
  while (s.event!.modular_state !== 'completed') s = score(s, s.matches.find(match => match.status === 'scheduled' && match.team_a_id && match.team_b_id)!.id);
  assert.equal(s.stages.find(stage => stage.id === cross.id)!.state, 'completed');
  assert.equal(s.standings.filter(row => row.stage_id === cross.id).length, 8);
});

test('correction preview includes dependent semifinal and final when a group winner changes', () => {
  let s = activeGroups();
  for (const m of s.matches.filter(m => ['A', 'B', 'C', 'D'].includes(String(s.stages.find(stage => stage.id === m.stage_id)?.node_id)))) s = score(s, m.id);
  const m = s.matches.find(m => m.logical_key === 'A:r1:m1')!;
  const preview = previewCorrection(s, owner, { match_id: m.id, score_a: Number(m.score_b), score_b: Number(m.score_a) });
  assert.ok(preview.affected_match_ids.includes(s.matches.find(m => m.logical_key === 'SF1:match')!.id));
  assert.ok(preview.affected_match_ids.includes(s.matches.find(m => m.logical_key === 'F:match')!.id));
});

test('an incomplete-group withdrawal excludes that entry only from its own group standings', () => {
  let s = activeGroups();
  const match = s.matches.find(m => m.logical_key === 'B:r1:m1')!;
  s = score(s, match.id);
  const entryId = String(match.team_a_id);
  const preview = previewWithdrawal(s, owner, { entry_id: entryId, reason: 'Player cannot continue' });
  s = execute(s, 'withdrawEntry', { entry_id: entryId, reason: 'Player cannot continue', preview_hash: preview.preview_hash });
  const groupB = s.stages.find(stage => stage.node_id === 'B')!;
  assert.equal((groupB.output as { rows: { entryId: string }[] }).rows.some(row => row.entryId === entryId), false);
  assert.equal(s.stages.find(stage => stage.node_id === 'A')!.state, 'ready');
  assert.equal(s.matches.filter(m => m.stage_id === s.stages.find(stage => stage.node_id === 'A')!.id && m.outcome_kind).length, 0);
  const excluded = s.standings.find(row => row.stage_id === groupB.id && row.team_id === entryId)!;
  assert.equal(excluded.eligible, false);
  assert.equal(excluded.rank, null);
});

test('a completed group winner withdrawal propagates an audited semifinal walkover', () => {
  let s = activeGroups();
  for (const m of s.matches.filter(m => ['A', 'B'].includes(String(s.stages.find(stage => stage.id === m.stage_id)?.node_id)))) s = score(s, m.id);
  const semifinal = s.matches.find(m => m.logical_key === 'SF1:match')!;
  const entryId = String(semifinal.team_a_id);
  const preview = previewWithdrawal(s, owner, { entry_id: entryId, reason: 'Unable to play semifinal' });
  s = execute(s, 'withdrawEntry', { entry_id: entryId, reason: 'Unable to play semifinal', preview_hash: preview.preview_hash });
  const completed = s.matches.find(m => m.id === semifinal.id)!;
  assert.equal(completed.status, 'walkover');
  assert.equal(completed.team_a_id, entryId, 'Historical participant identity remains stable');
  assert.equal(completed.winner_team_id, semifinal.team_b_id);
});

test('correcting semifinal points while keeping its winner does not replay the final', () => {
  let s = activeGroups();
  while (s.event!.modular_state !== 'completed') s = score(s, s.matches.find(m => m.status === 'scheduled' && m.team_a_id && m.team_b_id)!.id);
  const semifinal = s.matches.find(m => m.logical_key === 'SF1:match')!;
  const preview = previewCorrection(s, owner, { match_id: semifinal.id, score_a: Number(semifinal.score_a) === 11 ? 11 : 3, score_b: Number(semifinal.score_b) === 11 ? 11 : 3 });
  assert.deepEqual(preview.affected_match_ids, []);
});

test('automatic outcomes bind downstream group standings to the actual result revision', () => {
  const d = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
  d.registration.min_entries = d.registration.max_entries = 4;
  d.nodes = [d.nodes[0], d.nodes[1], d.nodes[2],
    { id: 'B', module: 'round_robin@2', inputs: [{ kind: 'rank', node_id: 'A', rank: 3 }, { kind: 'rank', node_id: 'A', rank: 4 }] },
    { id: 'F', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'A', rank: 1 }, { kind: 'rank', node_id: 'B', rank: 1 }] },
    { id: 'result', module: 'placements@2', final: 'F' }];
  let s = activeGroups(d);
  const first = s.matches.find(m => m.logical_key === 'A:r1:m1')!;
  s = score(s, first.id);
  const entryId = String(first.team_a_id);
  const preview = previewWithdrawal(s, owner, { entry_id: entryId, reason: 'Cannot continue' });
  s = execute(s, 'withdrawEntry', { entry_id: entryId, reason: 'Cannot continue', preview_hash: preview.preview_hash });
  for (const match of s.matches.filter(m => m.stage_id === s.stages.find(stage => stage.node_id === 'A')!.id && m.status === 'scheduled')) s = score(s, match.id);
  const groupB = s.stages.find(stage => stage.node_id === 'B')!;
  assert.equal(groupB.state, 'completed');
  const resultRevision = Math.max(...s.matches.filter(m => m.stage_id === groupB.id).map(m => Number(m.result_revision)));
  assert.equal((groupB.output as { inputRevision: number }).inputRevision, resultRevision);
});
