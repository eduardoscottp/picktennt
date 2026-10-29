import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { planCommand, type CommandSnapshot, type CommandActor } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewRevision } from '../../lib/tournament-builder/revisions';
import { previewSchedule } from '../../lib/tournament-builder/schedule-preview';
import { resolvedDefinition } from '../../lib/tournament-builder/resolved-definition';
import { entryPlayerIds } from '../../lib/tournament-builder/entry-roster';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import { publicMcpResult } from '../../lib/tournament-builder/mcp-output';
import { ADMIN_TOOLS } from '../../lib/tournament-builder/mcp-admin';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const owner = { id: randomUUID(), clientId: 'web' };
const context = { now: '2026-10-28T16:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
function apply(s: CommandSnapshot, command: string, data: Record<string, unknown> = {}, actor: CommandActor = owner) {
  const { effects } = planCommand(s, actor, command, data, context), n = structuredClone(s);
  n.event = { id: randomUUID(), created_by: owner.id, revision: 0, roster_revision: 0, ...n.event, ...effects.event };
  n.event.revision = Number(n.event.revision) + 1;
  if (effects.definition) { const old = n.definitions.find(d => d.id === effects.definition!.id); if (old) Object.assign(old, effects.definition); else n.definitions.push(effects.definition); }
  for (const table of ['teams','team_members','tournament_players','stages','rounds','matches','standings'] as const) for (const patch of effects[table] ?? []) {
    const old = n[table].find(r => r.id === patch.id); if (old) Object.assign(old, patch); else n[table].push(patch);
  }
  return n;
}
function setup(count = 8) {
  const d: GraphDefinition = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
  d.registration.min_entries = 8;
  let s: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  s = apply(s, 'createDraft', { definition: d });
  const p = previewDefinition(d, 1);
  s = apply(s, 'publishTournament', { reviewed_definition_hash: p.definitionHash, acknowledged_warning_codes: p.warningCodes });
  for (let i = 0; i < count; i++) s = apply(s, 'addRegisteredEntry', { definition_id: s.event!.definition_id, player_ids: [randomUUID(), randomUUID()], entry_name: `Team ${i}`, reason: 'Registration' });
  return { s, d };
}
function groupData(s: CommandSnapshot) {
  const teams = s.teams.filter(t => t.entry_state === 'approved');
  return { reviewed_roster_revision: s.event!.roster_revision, group_assignments: Object.fromEntries(['A','B','C','D'].map((g,i) => [g, teams.slice(i * 2, i * 2 + 2).map(t => t.id)])) };
}
function revise(s: CommandSnapshot, d: GraphDefinition, entries: unknown[] = []) {
  const data = { definition: d, entries, reason: 'Organizer reviewed revised teams and format' };
  return apply(s, 'reviseTournament', { ...data, preview_hash: previewRevision(s, owner, data).preview_hash });
}
test('revision preserves history, swaps players, regenerates and completes through final', () => {
  const initial = setup(), d = initial.d; let s = initial.s;
  s = apply(s, 'closeRegistration'); s = apply(s, 'lockRoster', groupData(s));
  const oldDefinition = structuredClone(s.definitions[0]), oldMatches = s.matches.map(m => m.id);
  const [a,b] = s.teams, pa = entryPlayerIds(s,a.id), pb = entryPlayerIds(s,b.id);
  s = revise(s, d, [{ entry_id:a.id,entry_name:'A swapped',player_ids:[pb[0],pa[1]] },{ entry_id:b.id,entry_name:'B swapped',player_ids:[pa[0],pb[1]] }]);
  assert.equal(s.event!.modular_state,'registration_closed'); assert.deepEqual(s.definitions[0],oldDefinition);
  assert.deepEqual(entryPlayerIds(s,a.id),[pa[1],pb[0]]); assert.equal(s.matches.filter(m=>m.is_current!==false).length,0);
  assert.equal(resolvedDefinition(s)!.id,s.event!.definition_id);
  const data = groupData(s), preview = previewSchedule(s,owner,data,context.now);
  assert.equal(new Set(preview.fixtures.map(f => `${f.wave}:${f.court}`)).size, preview.fixtures.length, JSON.stringify(preview.fixtures));
  s = apply(s,'lockRoster',{...data,preview_hash:preview.preview_hash});
  assert.equal(s.matches.filter(m=>m.is_current!==false).length,7);
  assert.ok(s.matches.filter(m=>oldMatches.includes(m.id)).every(m=>m.is_current===false));
  for (const fixture of preview.fixtures) { const m=s.matches.find(m=>m.logical_key===fixture.id&&m.is_current!==false)!; assert.equal(m.court_number,fixture.court); assert.equal(s.rounds.find(r=>r.id===m.round_id)!.logical_wave,fixture.wave); }
  s=apply(s,'startTournament');
  for(let i=0;i<7;i++) { const m=s.matches.find(m=>m.is_current!==false&&m.status==='scheduled'&&m.team_a_id&&m.team_b_id)!; assert.ok(m); s=apply(s,'attestScore',{match_id:m.id,score_a:11,score_b:0,reason:'Verified score'}); }
  assert.equal(s.event!.modular_state,'completed');
});
test('revision rejects duplicates, unsafe capacity, broken routing, stale review and played history',()=>{
  const {s,d}=setup(), data={definition:d,reason:'Review'};
  const review=previewRevision(s,owner,data);
  assert.throws(()=>apply(s,'reviseTournament',{...data,reason:'Different',preview_hash:review.preview_hash}),/Review the current/);
  const stale=structuredClone(s); stale.event!.revision=Number(stale.event!.revision)+1;
  assert.throws(()=>apply(stale,'reviseTournament',{...data,preview_hash:review.preview_hash}),/Review the current/);
  assert.throws(()=>previewRevision(s,{id:randomUUID(),clientId:'web'},data),/permission/);
  assert.throws(()=>revise(s,d,[{entry_id:s.teams[0].id,entry_name:'Duplicate',player_ids:entryPlayerIds(s,s.teams[1].id)}]),/two retained teams/);
  const invalid=structuredClone(d); invalid.nodes=invalid.nodes.filter(n=>n.id!=='A');
  assert.throws(()=>previewRevision(s,owner,{...data,definition:invalid}),/partition|missing|reference|source|unknown/i);
  const played=structuredClone(s); played.matches.push({id:randomUUID(),status:'scheduled',started_at:context.now,is_current:false});
  assert.throws(()=>previewRevision(played,owner,data),/started/);
  const details=apply(played,'updateEventDetails',{name:'Corrected',venue_name:'New venue label',reason:'Typo'});
  assert.equal(details.event!.name,'Corrected'); assert.deepEqual(details.matches,played.matches); assert.deepEqual(details.definitions,played.definitions);
});
test('revision permits fewer teams and closes registration until actual roster is ready',()=>{
  const {s,d}=setup(10), t=s.teams[0];
  const next=revise(s,d,[{entry_id:t.id,entry_name:String(t.name),player_ids:[],remove:true}]);
  assert.equal(next.teams.filter(t=>t.entry_state==='approved').length,9);
  assert.equal(entryPlayerIds(next,t.id).length,0);
  assert.equal(next.matches.length,0);
});
test('capacity reduction needs explicit removals and singles conversion needs the full resulting roster',()=>{
  const {s,d}=setup(10), smaller=structuredClone(d);
  smaller.registration.max_entries=8;
  let seed=1;
  for(const node of smaller.nodes) if(node.module==='round_robin@2') node.inputs=[{kind:'seed',seed:seed++},{kind:'seed',seed:seed++}];
  assert.throws(()=>revise(s,smaller),/Capacity is below/);
  const removals=s.teams.slice(8).map(t=>({entry_id:t.id,remove:true}));
  let next=revise(s,smaller,removals);
  assert.equal(next.teams.filter(t=>t.entry_state==='approved').length,8);
  const singles=structuredClone(smaller); singles.registration.entry_type='singles'; singles.registration.partner_consent=false;
  assert.throws(()=>revise(next,singles),/1 registered player/);
  next=revise(next,singles,next.teams.filter(t=>t.entry_state==='approved').map(t=>({entry_id:t.id,entry_name:String(t.name),player_ids:entryPlayerIds(next,t.id).slice(0,1)})));
  const data=groupData(next), review=previewSchedule(next,owner,data,context.now);
  next=apply(next,'lockRoster',{...data,preview_hash:review.preview_hash});
  assert.equal(next.matches.filter(m=>m.is_current!==false).length,7);
});
test('pending entrants can accept revised rules without fabricating prior consent',()=>{
  let {s,d}=setup(0); const user={id:randomUUID(),clientId:'web'}, partner={id:randomUUID(),clientId:'web'};
  d={...d,registration:{...d.registration,mode:'open'}};
  s=revise(s,d); s=apply(s,'reopenRegistration');
  s=apply(s,'requestEntry',{definition_id:s.event!.definition_id,consent:true,partner_id:partner.id,entry_name:'Pending'},user);
  const team=s.teams[0]; const prior=s.team_members[0].consented_definition_id;
  s=revise(s,d); assert.equal(s.team_members[0].consented_definition_id,prior); s=apply(s,'reopenRegistration');
  s=apply(s,'acceptPartner',{entry_id:team.id,definition_id:s.event!.definition_id,consent:true},user);
  assert.equal(s.teams[0].entry_state,'pending');
  s=apply(s,'acceptPartner',{entry_id:team.id,definition_id:s.event!.definition_id,consent:true},partner);
  assert.equal(s.teams[0].entry_state,'approved');
});
test('schedule reviews are stable and reject stale group choices; MCP retains review fields',()=>{
  let {s}=setup(); s=apply(s,'closeRegistration'); const data=groupData(s);
  const review=previewSchedule(s,owner,data,context.now); assert.deepEqual(previewSchedule(s,owner,data,context.now),review);
  const changed=structuredClone(data); [changed.group_assignments.A[0],changed.group_assignments.B[0]]=[changed.group_assignments.B[0],changed.group_assignments.A[0]];
  assert.throws(()=>apply(s,'lockRoster',{...changed,preview_hash:review.preview_hash}),/schedule changed/);
  const dto=publicMcpResult('admin_preview_schedule',{...review,secret:'hidden'}) as Record<string,unknown>;
  assert.equal(dto.preview_hash,review.preview_hash); assert.ok(Array.isArray(dto.fairness)); assert.equal(dto.secret,undefined);
  const tool=ADMIN_TOOLS.find(t=>t.name==='admin_lock_roster')!;
  assert.equal(new AjvJsonSchemaValidator().getValidator(tool.inputSchema)({tournament_id:s.event!.id,operation_id:randomUUID(),expected_revision:s.event!.revision,confirmed_structure_change:true,data:{...data,preview_hash:review.preview_hash}}).valid,true);
});
