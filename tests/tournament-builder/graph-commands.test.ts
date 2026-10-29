import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planCommand, type CommandSnapshot, type CommandPlan, type CommandActor } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';

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
  const preview = previewDefinition(d, 1);
  let s = execute(empty(), 'createDraft', { definition: d });
  s = execute(s, 'publishTournament', { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes });
  for (let i = 0; i < d.registration.max_entries; i++) s = execute(s, 'addRegisteredEntry', { definition_id: s.event!.definition_id, player_ids: [id(), id()], entry_name: `Team ${i + 1}`, reason: 'Organizer enrollment of real profiles' });
  s = execute(s, 'closeRegistration');
  s = execute(s, 'lockRoster', { reviewed_roster_revision: s.event!.roster_revision });
  return execute(s, 'startTournament');
}
function score(s: CommandSnapshot, matchId: string) {
  const row = s.matches.find(m => m.id === matchId)!;
  const a = Number(s.teams.find(t => t.id === row.team_a_id)!.seed), b = Number(s.teams.find(t => t.id === row.team_b_id)!.seed);
  return execute(s, 'attestScore', { match_id: matchId, score_a: a < b ? 11 : 2, score_b: a < b ? 2 : 11, reason: 'Verified result' });
}

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
