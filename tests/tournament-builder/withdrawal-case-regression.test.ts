import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planCommand, type CommandActor, type CommandPlan, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { definitionHash } from '../../lib/tournament-builder/requests';
import { previewTeamForfeit, TEAM_FORFEIT_POLICY } from '../../lib/tournament-builder/team-forfeit';

let sequence = 60000;
const id = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
const owner: CommandActor = { id: id(), clientId: 'web', role: 'owner' };
const context = { now: '2026-10-28T16:00:00.000Z', id, draw: (ids: readonly string[]) => [...ids] };
function apply(snapshot: CommandSnapshot, plan: CommandPlan): CommandSnapshot {
  const next = structuredClone(snapshot);
  next.event = { id: next.event?.id ?? id(), created_by: owner.id, revision: 0, roster_revision: 0, result_version: 0, ...next.event, ...plan.effects.event };
  next.event.revision = Number(next.event.revision) + 1;
  if (plan.effects.definition) next.definitions.push(plan.effects.definition);
  if (plan.effects.replace_standings_stage_ids) next.standings = next.standings.filter(row => !plan.effects.replace_standings_stage_ids!.includes(String(row.stage_id)));
  for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) {
    for (const patch of plan.effects[table] ?? []) {
      const row = next[table].find(item => item.id === patch.id);
      if (row) Object.assign(row, patch); else next[table].push(patch);
    }
  }
  return next;
}
function run(snapshot: CommandSnapshot, command: string, data: Record<string, unknown>) {
  return apply(snapshot, planCommand(snapshot, owner, command, data, context));
}
function setup(graph = false, target = 11, combined = false) {
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  definition.registration = { ...definition.registration, mode: 'open', entry_type: 'singles', partner_consent: false, min_entries: 2, max_entries: 3 };
  if (combined) definition.nodes.find((node: {module:string})=>node.module==='qualify@1').config.count=2;
  else definition.nodes = definition.nodes.slice(0, 4).concat({ id: 'result', module: 'placements@1', from: 'rank' });
  definition.policies.match.target = target;
  if (graph) {
    definition.schema_version = '2.0';
    definition.nodes = [definition.nodes[0], definition.nodes[1], {id:'rr',module:'round_robin@2',inputs:[1,2,3].map(seed=>({kind:'seed',seed}))}, {id:'F',module:'match@1',inputs:[1,2].map(rank=>({kind:'rank',node_id:'rr',rank}))}, {id:'result',module:'placements@2',final:'F'}];
  }
  let snapshot: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  snapshot = run(snapshot, 'createDraft', { definition });
  snapshot = run(snapshot, 'publishTournament', { reviewed_definition_hash: definitionHash(definition), acknowledged_warning_codes: [] });
  for (const name of ['A', 'B', 'C']) snapshot = apply(snapshot, planCommand(snapshot, { id: id(), clientId: 'web' }, 'requestEntry', { consent: true, definition_id: snapshot.event!.definition_id, entry_name: name }, context));
  snapshot = run(snapshot, 'closeRegistration', {});
  snapshot = run(snapshot, 'lockRoster', { reviewed_roster_revision: snapshot.event!.roster_revision });
  return run(snapshot, 'startTournament', {});
}

test('withdrawing cannot overwrite a submitted or disputed score with a no-contest', () => {
  for (const status of ['score_entered', 'disputed']) {
    const snapshot = setup();
    const match = snapshot.matches[0];
    Object.assign(match, { status, outcome_kind: 'played', score_a: 11, score_b: 3, started_at: context.now });
    const before = structuredClone(match);
    const data = { entry_id: match.team_a_id, reason: 'Leaving tournament' };
    assert.throws(() => previewWithdrawal(snapshot, owner, data, context.now), { code: 'UNRESOLVED_RESULT' });
    assert.throws(() => planCommand(snapshot, owner, 'withdrawEntry', { ...data, preview_hash: 'previous-preview' }, context), { code: 'UNRESOLVED_RESULT' });
    assert.deepEqual(match, before);
  }
});

for (const graph of [false, true]) test(`${graph ? 'graph' : 'v1'} web team withdrawal awards every past and future game 0–11 despite a 21-point match policy`, () => {
  let snapshot = setup(graph, 21);
  const team = snapshot.teams[0], games = snapshot.matches.filter(match => [match.team_a_id, match.team_b_id].includes(team.id));
  const prior = games[0];
  snapshot = run(snapshot, 'attestScore', {match_id:prior.id,outcome_kind:'played',score_a:21,score_b:5,reason:'Observed game'});
  const archived = {...snapshot.matches.find(match=>match.id===prior.id)!,id:id(),is_current:false};
  snapshot.matches.push(archived);
  const unrelated = structuredClone(snapshot.matches.filter(match=>match.id!==archived.id&&match.team_a_id&&match.team_b_id&&![match.team_a_id,match.team_b_id].includes(team.id)));
  const data = {entry_id:team.id,reason:'Team left',policy:TEAM_FORFEIT_POLICY};
  const preview = previewTeamForfeit(snapshot,owner,data);
  assert.equal(preview.proposed_matches.length,2);
  assert.equal(preview.dupr_history_unknown,true);
  assert.throws(()=>run(snapshot,'withdrawEntry',{...data,preview_hash:preview.preview_hash}),{code:'CONFIRMATION_REQUIRED'});
  assert.throws(()=>run(snapshot,'withdrawEntry',{...data,preview_hash:'0'.repeat(64),confirmed_forfeit:true}),{code:'STALE_PREVIEW'});
  snapshot = run(snapshot,'withdrawEntry',{...data,preview_hash:preview.preview_hash,confirmed_forfeit:true});
  for (const game of games) {
    const after=snapshot.matches.find(match=>match.id===game.id)!;
    assert.equal(after.outcome_kind,'administrative_score'); assert.equal(after.submit_to_dupr,false);
    assert.equal(after.score_a,after.team_a_id===team.id?0:11); assert.equal(after.score_b,after.team_b_id===team.id?0:11);
  }
  assert.deepEqual(snapshot.matches.find(match=>match.id===archived.id),archived);
  for (const game of unrelated) assert.deepEqual(snapshot.matches.find(match=>match.id===game.id),game);
  const standing=snapshot.standings.find(row=>row.team_id===team.id)!;
  assert.equal(standing.wins,0); assert.equal(standing.losses,2); assert.equal(standing.points_for,0); assert.equal(standing.points_against,22); assert.equal(standing.eligible,false); assert.equal(standing.rank,null);
});

test('all-game withdrawal rejects MCP, nonadmins, prestart use and already withdrawn opponents',()=>{
  const snapshot=setup(),team=snapshot.teams[0],data={entry_id:team.id,reason:'Team left',policy:TEAM_FORFEIT_POLICY};
  assert.throws(()=>previewTeamForfeit(snapshot,{...owner,clientId:'mcp',permissions:['admin:manage']},data),{code:'FORBIDDEN'});
  assert.throws(()=>previewTeamForfeit(snapshot,{id:id(),clientId:'web',role:'player'},data),{code:'FORBIDDEN'});
  const before=structuredClone(snapshot); before.event!.modular_state='ready';
  assert.throws(()=>previewTeamForfeit(before,owner,data),{code:'INVALID_STATE'});
  const opponent=snapshot.teams[1]; opponent.entry_state='withdrawn';
  assert.throws(()=>previewTeamForfeit(snapshot,owner,data),{code:'OPPONENT_WITHDRAWN'});
});

for (const graph of [false,true]) test(`${graph?'graph':'v1'} full withdrawal blocks changed played bracket dependencies without altering results`,()=>{
  let snapshot=setup(graph,11,true);
  for(const game of snapshot.matches.filter(match=>String(match.logical_key).startsWith('rr:'))) {
    const a=snapshot.teams.find(team=>team.id===game.team_a_id)!,b=snapshot.teams.find(team=>team.id===game.team_b_id)!;
    snapshot=run(snapshot,'attestScore',{match_id:game.id,outcome_kind:'played',score_a:String(a.name)<String(b.name)?11:3,score_b:String(a.name)<String(b.name)?3:11,reason:'Observed'});
  }
  const final=snapshot.matches.find(match=>!String(match.logical_key).startsWith('rr:'))!;
  snapshot=run(snapshot,'attestScore',{match_id:final.id,outcome_kind:'played',score_a:11,score_b:5,reason:'Observed final'});
  const before=structuredClone(snapshot);
  assert.throws(()=>previewTeamForfeit(snapshot,owner,{entry_id:final.team_a_id,reason:'Team left',policy:TEAM_FORFEIT_POLICY}),{code:'DOWNSTREAM_STARTED'});
  assert.deepEqual(snapshot,before);
});

test('explicit all-game confirmation replaces provisional and live scores without changing source snapshot',()=>{
  for(const status of ['score_entered','disputed','in_progress']) {
    const snapshot=setup(),match=snapshot.matches[0];
    Object.assign(match,{status,score_a:7,score_b:3,started_at:context.now,outcome_kind:status==='in_progress'?null:'played'});
    const before=structuredClone(snapshot),data={entry_id:match.team_a_id,reason:'Reviewed full withdrawal',policy:TEAM_FORFEIT_POLICY};
    const preview=previewTeamForfeit(snapshot,owner,data);
    const after=run(snapshot,'withdrawEntry',{...data,preview_hash:preview.preview_hash,confirmed_forfeit:true});
    assert.deepEqual(snapshot,before);
    assert.equal(after.matches.find(row=>row.id===match.id)!.score_a,0);
    assert.equal(after.matches.find(row=>row.id===match.id)!.score_b,11);
  }
});

test('completed all-game withdrawal uses one reviewed owner operation and recomputes placements',()=>{
  let snapshot=setup();
  for(const game of snapshot.matches) snapshot=run(snapshot,'attestScore',{match_id:game.id,outcome_kind:'played',score_a:11,score_b:3,reason:'Observed'});
  if(snapshot.event!.modular_state!=='completed') {
    const stage=snapshot.stages.find(row=>row.module_id==='standings')!;
    const output=stage.output as {ties:string[][];inputRevision:number};
    for(const group of output.ties) snapshot=run(snapshot,'resolveTie',{stage_id:stage.id,entry_ids:group,input_revision:output.inputRevision});
  }
  assert.equal(snapshot.event!.modular_state,'completed');
  const data={entry_id:snapshot.teams[0].id,reason:'Team left',policy:TEAM_FORFEIT_POLICY},version=Number(snapshot.event!.result_version);
  assert.throws(()=>previewTeamForfeit(snapshot,{id:id(),clientId:'web',role:'admin'},data),{code:'FORBIDDEN'});
  const preview=previewTeamForfeit(snapshot,owner,data);
  assert.equal(preview.reopens_completed_results,true);
  snapshot=run(snapshot,'withdrawEntry',{...data,preview_hash:preview.preview_hash,confirmed_forfeit:true});
  assert.equal(snapshot.event!.modular_state,'completed');assert.equal(snapshot.event!.result_version,version+1);
});

test('a final-match retirement correction and full withdrawal preserve history while removing eligibility', () => {
  let snapshot = setup();
  const [a, b, c] = snapshot.teams;
  const pair = (x: string, y: string) => snapshot.matches.find(match => [match.team_a_id, match.team_b_id].includes(x) && [match.team_a_id, match.team_b_id].includes(y))!;
  for (const [winner, loser, points] of [[b, a, 3], [c, a, 4]] as const) {
    const match = pair(winner.id, loser.id);
    snapshot = run(snapshot, 'attestScore', { match_id: match.id, outcome_kind: 'played', score_a: match.team_a_id === winner.id ? 11 : points, score_b: match.team_b_id === winner.id ? 11 : points, reason: 'Reviewed played result' });
  }
  const final = pair(b.id, c.id);
  snapshot = run(snapshot, 'attestScore', { match_id: final.id, outcome_kind: 'retirement', winner_entry_id: b.id, reason: 'Mistaken winner selected' });
  assert.equal(snapshot.event!.modular_state, 'completed');
  assert.equal(snapshot.teams.find(team => team.id === b.id)!.entry_state, 'approved');
  assert.equal(snapshot.standings.find(row => row.team_id === b.id)!.wins, 2);
  const played = structuredClone(snapshot.matches.filter(match => match.outcome_kind === 'played'));
  const archived = { ...snapshot.matches[0], id: id(), status: 'scheduled', is_current: false, score_a: null, score_b: null, winner_team_id: null, outcome_kind: null };
  snapshot.matches.push(archived);
  snapshot = run(snapshot, 'reopenResults', { reason: 'Review mistaken winner' });
  const correction = { match_id: final.id, outcome_kind: 'retirement', winner_entry_id: c.id };
  const review = previewCorrection(snapshot, owner, correction);
  snapshot = run(snapshot, 'commitCorrection', { ...correction, preview_hash: review.preview_hash, reason: 'Opponent won', resolution: 'ordinary' });
  assert.equal(snapshot.event!.modular_state, 'completed');
  snapshot = run(snapshot, 'reopenResults', { reason: 'Record full withdrawal' });
  const withdrawal = { entry_id: b.id, reason: 'Leaving tournament' };
  const preview = previewWithdrawal(snapshot, owner, withdrawal, context.now);
  assert.equal(preview.timing, 'completed_rr_before_playoff');
  assert.equal(preview.round_robin_results_excluded, false);
  snapshot = run(snapshot, 'withdrawEntry', { ...withdrawal, preview_hash: preview.preview_hash });
  assert.equal(snapshot.event!.modular_state, 'completed');
  assert.deepEqual(snapshot.matches.filter(match => match.outcome_kind === 'played'), played);
  assert.deepEqual(snapshot.matches.find(match => match.id === archived.id), archived);
  assert.equal(snapshot.matches.find(match => match.id === final.id)!.score_a, null);
  assert.equal(snapshot.matches.find(match => match.id === final.id)!.score_b, null);
  assert.equal(snapshot.matches.find(match => match.id === final.id)!.winner_team_id, c.id);
  assert.equal(snapshot.teams.find(team => team.id === b.id)!.entry_state, 'withdrawn');
  const row = snapshot.standings.find(item => item.team_id === b.id)!;
  assert.equal(row.eligible, false); assert.equal(row.rank, null);
  assert.equal(row.wins, 1); assert.equal(row.losses, 1);
  assert.equal(snapshot.standings.find(item => item.team_id === c.id)!.rank, 1);
  assert.equal(snapshot.standings.find(item => item.team_id === a.id)!.rank, 2);
});
