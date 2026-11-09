import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastProvider } from '../../components/ui/toast';
import { TournamentBuilder } from '../../components/tournament-builder/builder';
import { planCommand, type CommandSnapshot, type CommandPlan, type CommandActor } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewWithdrawal } from '../../lib/tournament-builder/corrections';
import { presentStandings } from '../../lib/tournament-builder/standings-presentation';
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';

const id = () => crypto.randomUUID();
const owner: CommandActor = { id: id(), clientId: 'web', role: 'owner' };
const context = { now: '2026-10-28T16:00:00Z', id, draw: (ids: readonly string[]) => [...ids] };
function apply(snapshot: CommandSnapshot, plan: CommandPlan): CommandSnapshot {
 const next = structuredClone(snapshot);
 next.event = { id: next.event?.id ?? id(), created_by: owner.id, roster_revision: 0, result_version: 0, ...next.event, ...plan.effects.event, revision: Number(next.event?.revision ?? 0) + 1 };
 if (plan.effects.definition) {
  const previous = next.definitions.find(row => row.id === plan.effects.definition!.id);
  if (previous) Object.assign(previous, plan.effects.definition); else next.definitions.push(plan.effects.definition);
 }
 for (const table of ['teams','team_members','tournament_players','stages','rounds','matches','standings'] as const) for (const patch of plan.effects[table] ?? []) {
  const previous = next[table].find(row => row.id === patch.id);
  if (previous) Object.assign(previous, patch); else next[table].push(patch);
 }
 return next;
}
function execute(snapshot: CommandSnapshot, command: string, data = {}, actor = owner) {
 return apply(snapshot, planCommand(snapshot, actor, command, data, context));
}
function setup(graph: boolean) {
 const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json','utf8'));
 definition.registration = {...definition.registration, mode:'open', entry_type:'singles', partner_consent:false, min_entries:4, max_entries:4};
 if (graph) {
  definition.schema_version = '2.0';
  definition.nodes = [definition.nodes[0],definition.nodes[1],{id:'rr',module:'round_robin@2',inputs:[1,2,3,4].map(seed=>({kind:'seed',seed}))},{id:'F',module:'match@1',inputs:[1,2].map(rank=>({kind:'rank',node_id:'rr',rank}))},{id:'result',module:'placements@2',final:'F'}];
 } else definition.nodes.find((node: {module:string})=>node.module==='qualify@1').config.count=2;
 let snapshot: CommandSnapshot = {event:null,definitions:[],teams:[],team_members:[],tournament_players:[],stages:[],rounds:[],matches:[],standings:[]};
 const preview = previewDefinition(definition,0);
 assert.equal(preview.valid,true);
 snapshot=execute(snapshot,'createDraft',{definition});
 snapshot=execute(snapshot,'publishTournament',{reviewed_definition_hash:preview.definitionHash,acknowledged_warning_codes:preview.warningCodes});
 for(const name of ['A','B','C','D']) snapshot=execute(snapshot,'requestEntry',{definition_id:snapshot.event!.definition_id,consent:true,entry_name:name},{id:id(),clientId:'web',role:'player'});
 snapshot=execute(snapshot,'closeRegistration');
 snapshot=execute(snapshot,'lockRoster',{reviewed_roster_revision:snapshot.event!.roster_revision});
 snapshot=execute(snapshot,'startTournament');
 for(const match of snapshot.matches.filter(row=>String(row.logical_key).startsWith('rr:'))) {
  const a=snapshot.teams.find(team=>team.id===match.team_a_id)!;
  const b=snapshot.teams.find(team=>team.id===match.team_b_id)!;
  const aWins=String(a.name)<String(b.name);
  snapshot=execute(snapshot,'attestScore',{match_id:match.id,outcome_kind:'played',score_a:aWins?11:2,score_b:aWins?2:11,reason:'Observed result'});
 }
 return {snapshot,definition};
}
for(const graph of [false,true]) test((graph?'graph':'v1')+' withdrawal demotes standings without rewriting completed results or historical stage rank',()=>{
 const initial=setup(graph), definition=initial.definition;
 let snapshot=initial.snapshot;
 const withdrawn=snapshot.teams.find(team=>team.name==='A')!;
 const before=snapshot.standings.find(row=>row.team_id===withdrawn.id)!;
 assert.equal(before.rank,1);assert.equal(before.wins,3);
 const history=structuredClone(snapshot.matches.filter(row=>String(row.logical_key).startsWith('rr:')));
 const data={entry_id:withdrawn.id,reason:'Team withdrew after round robin'};
 const preview=previewWithdrawal(snapshot,owner,data,context.now);
 snapshot=execute(snapshot,'withdrawEntry',{...data,preview_hash:preview.preview_hash});
 const row=snapshot.standings.find(row=>row.team_id===withdrawn.id)!;
 assert.equal(row.rank,null);assert.equal(row.eligible,false);assert.equal(row.tie_group,null);
 assert.equal(row.wins,3);assert.equal(row.losses,0);assert.equal(row.points_for,before.points_for);
 assert.deepEqual(snapshot.matches.filter(row=>String(row.logical_key).startsWith('rr:')),history);
 const ranked=presentStandings(snapshot.standings,snapshot.teams);
 assert.equal(ranked.at(-1)!.team_id,withdrawn.id);
 assert.deepEqual(ranked.slice(0,3).map(row=>row.rank),[1,2,3]);
 const stage=snapshot.stages.find(stage=>stage.module_id===(graph?'round_robin':'standings'))!;
 assert.equal((stage.output as {rows:{entryId:string}[]}).rows[0].entryId,withdrawn.id);
 const dto=publicMcpResult('admin_get_tournament',snapshot) as {standings:typeof ranked};
 assert.deepEqual(dto.standings.map(row=>[row.team_id,row.rank,row.eligible]),ranked.map(row=>[row.team_id,row.rank,row.eligible]));
 const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){},bfcacheId:'test'};
 const html=renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(ToastProvider,null,createElement(TournamentBuilder,{actorId:owner.id,initialSnapshot:snapshot,initialPreview:previewDefinition(definition,Number(snapshot.event!.revision)),view:'standings'}))));
 assert.match(html,/Withdrawn/);assert.equal((html.match(/aria-label="Rank 1"/g)??[]).length,1);
});

test('stale persisted rank is normalized per stage and tied active ranks stay tied',()=>{
 const rows=[{id:'a',stage_id:'one',team_id:'a',rank:1,wins:8,tie_group:'a,b'},{id:'b',stage_id:'one',team_id:'b',rank:1,wins:8,tie_group:'a,b'},{id:'c',stage_id:'one',team_id:'c',rank:3,wins:4,tie_group:'c,d'},{id:'d',stage_id:'one',team_id:'d',rank:3,wins:4,tie_group:'c,d'},{id:'e',stage_id:'two',team_id:'e',rank:1,wins:2}];
 const teams=['a','b','c','d','e'].map(id=>({id,entry_state:id==='a'?'withdrawn':'approved'}));
 const original=structuredClone(rows),result=presentStandings(rows,teams);
 assert.deepEqual(result.map(row=>[row.team_id,row.rank]),[['b',1],['c',2],['d',2],['a',null],['e',1]]);
 assert.equal(result[0].tie_group,null);assert.equal(result[1].tie_group,'c,d');assert.equal(result[3].wins,8);
 assert.deepEqual(rows,original);
});
