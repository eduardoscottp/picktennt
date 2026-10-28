import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { callTournamentTool, createTournamentMcpServer, type McpDependencies } from '../../lib/tournament-builder/mcp';
const id = 'b27c31ec-0c66-4bf6-94c4-708432cd11a0';
const deps: McpDependencies = {
  execute: async (command, tournamentId, input) => ({ command, tournamentId, input }),
  getDraft: async tournamentId => ({ tournament_id: tournamentId, revision: 3, status: 'draft', definition: { event: { name: 'Previously saved name' } } }),
  preview: async () => ({ valid: false, missing_fields: ['event.starts_at'] }),
  operation: async () => ({ revision: 1 }),
  reviewLink: async () => ({ url: 'https://picktennt.example/review' }),
};

test('real MCP client initializes, discovers bounded tools and receives missing questions', async () => {
  const server = createTournamentMcpServer(deps);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 9);
    assert.ok(listed.tools.every(tool => !/publish|score|delete/.test(tool.name)));
    const preview = await client.callTool({ name: 'validate_draft', arguments: { tournament_id: id } });
    assert.ok(JSON.stringify(preview).includes('event.starts_at'));
    const mutation = await client.callTool({ name: 'create_draft', arguments: { operation_id: id, data: { definition: { event: { name: 'Saturday' } } } } });
    assert.ok(JSON.stringify(mutation).includes('createDraft'));
  } finally { await client.close(); await server.close(); }
});

test('tool boundary rejects unauthorized actions and identity injection', async () => {
  await assert.rejects(callTournamentTool('publishTournament', {}, deps));
  await assert.rejects(callTournamentTool('list_modules', { actor_id: id }, deps));
  await assert.rejects(callTournamentTool('update_draft', { tournament_id: id, operation_id: id, data: {} }, deps));
  await assert.rejects(callTournamentTool('get_operation', { tournament_id: id, operation_id: 'oops' }, deps));
});

test('get_draft returns the exact incomplete saved manifest so replacement edits preserve known facts',async()=>{
 const value=await callTournamentTool('get_draft',{tournament_id:id},deps);
 assert.deepEqual(value,{tournament_id:id,revision:3,status:'draft',definition:{event:{name:'Previously saved name'}}});
 await assert.rejects(callTournamentTool('get_draft',{tournament_id:'not-a-uuid'},deps));
 await assert.rejects(callTournamentTool('get_draft',{tournament_id:id,actor_id:id},deps));
});

test('administrator tools require scoped dependencies, expose exact schemas and require structural confirmation',async()=>{
 const {ADMIN_TOOLS}=await import('../../lib/tournament-builder/mcp-admin');
 const calls:unknown[]=[];
 const adminDeps:McpDependencies={...deps,execute:async(command,tournamentId,input)=>{calls.push({command,tournamentId,input});return {command};},admin:{snapshot:async()=>({revision:4,caller_role:'admin'}),findPlayer:async(_id,username)=>({id,username}),previewCorrection:async()=>({preview_hash:'current-impact'}),previewWithdrawal:async()=>({preview_hash:'current-impact'})}};
 const capability=await callTournamentTool('get_capabilities',{},adminDeps) as {participant_enrollment:{ai_can_enroll:boolean;instructions:string}};
 assert.equal(capability.participant_enrollment.ai_can_enroll,true);assert.match(capability.participant_enrollment.instructions,/admin_register_players/);assert.doesNotMatch(capability.participant_enrollment.instructions,/Never pre-enroll/);
 assert.ok(ADMIN_TOOLS.some(t=>t.name==='admin_register_players'));
 await assert.rejects(callTournamentTool('admin_get_tournament',{tournament_id:id},deps));
 assert.deepEqual(await callTournamentTool('admin_get_tournament',{tournament_id:id},adminDeps),{revision:4,caller_role:'admin'});
 await assert.rejects(callTournamentTool('admin_lock_roster',{tournament_id:id,operation_id:id,expected_revision:4,data:{reviewed_roster_revision:3}},adminDeps),/structural impact/);
 assert.equal(calls.length,0);
 await callTournamentTool('admin_lock_roster',{tournament_id:id,operation_id:id,expected_revision:4,data:{reviewed_roster_revision:3},confirmed_structure_change:true},adminDeps);
 assert.equal(calls.length,1);
 await assert.rejects(callTournamentTool('admin_get_tournament',{tournament_id:id,actor_id:id},adminDeps));
 const server=createTournamentMcpServer(adminDeps),client=new Client({name:'scoped-admin-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 await Promise.all([server.connect(a),client.connect(b)]);
 try{const listed=await client.listTools();assert.ok(listed.tools.some(t=>t.name==='admin_save_result'));assert.ok(!listed.tools.some(t=>/publish|reopen_results|cancel_tournament|guest/.test(t.name)));}finally{await client.close();await server.close();}
});
