import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import { generateRoundRobin } from '../../lib/tournament-builder/modules/round-robin';
import type { GraphDefinition, GraphNode, GraphSource } from '../../lib/tournament-builder/graph-types';

test('SQL reconstructs each RR and cross-play fixture port from the graph', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA tournament_builder_private; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.tournament_stages(id uuid, tournament_id uuid, definition_id uuid, node_id text, state text, output jsonb);
      CREATE TABLE public.matches(id uuid, tournament_id uuid, stage_id uuid, logical_key text, is_current boolean, voided_at timestamptz, status text, outcome_kind text, winner_team_id uuid, team_a_id uuid, team_b_id uuid, bracket_next_winner_match_id uuid, bracket_winner_fills_side text, bracket_next_loser_match_id uuid, bracket_loser_fills_side text);
      CREATE TABLE public.teams(id uuid, tournament_id uuid, entry_state text);
      CREATE TABLE public.standings(id uuid, tournament_id uuid, stage_id uuid);
      CREATE FUNCTION tournament_builder_private.assert_keys(value jsonb, allowed text[]) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT (k=ANY(allowed))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF; END $$;
      CREATE FUNCTION tournament_builder_private.graph_seed(output jsonb, seed integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE WHEN output ? 'seedAssignments' THEN output->'seedAssignments'->>seed::text ELSE output->'entryIds'->>(seed-1) END $$;`);
    await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
    for (const mode of ['pool', 'cross'] as const) {
      const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
      definition.schema_version = '2.0'; definition.registration.entry_type = 'singles';
      definition.registration.min_entries = definition.registration.max_entries = 4;
      const ranks: GraphSource[] = [1, 2, 3, 4].map(rank => ({ kind: 'rank', node_id: 'source', rank }));
      const next: GraphNode = mode === 'pool'
        ? { id: 'next', module: 'round_robin@2', inputs: ranks }
        : { id: 'next', module: 'cross_play@1', side_a: ranks.slice(0, 2), side_b: ranks.slice(2) };
      definition.nodes = [
        { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
        { id: 'source', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(seed => ({ kind: 'seed', seed })) }, next,
        { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'next', rank: 1 }, { kind: 'rank', node_id: 'next', rank: 2 }] },
        { id: 'places', module: 'placements@2', final: 'final' },
      ];
      const analysis = analyzeGraph(definition, ['a', 'b', 'c', 'd'].map(id => ({ id, playerIds: [id] })), []);
      const expected = analysis.resolvedFixtures.filter(f => f.fixture.stageId === 'next').map(f => ({ logical_key: f.fixture.id, port_a: analysis.fixtureSources[f.fixture.id][0], port_b: analysis.fixtureSources[f.fixture.id][1] }));
      const actual = (await db.query<{ logical_key: string; port_a: unknown; port_b: unknown }>('SELECT * FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(next), JSON.stringify({ entryIds: ['a', 'b', 'c', 'd'] })])).rows;
      assert.deepEqual(actual, expected);
    }
    for (let count = 2; count <= 16; count++) {
      const inputs = Array.from({ length: count + 1 }, (_, i) => ({ kind: 'seed', seed: i + 1 }));
      const assignments = Object.fromEntries(inputs.filter(source => source.seed !== 2).map(source => [source.seed, `entry-${source.seed}`]));
      const used = inputs.filter(source => source.seed !== 2);
      const node = { id: 'odd', module: 'round_robin@2', inputs };
      const tokens = used.map((_, i) => ({ id: String(i), playerIds: [String(i)] }));
      const expected = generateRoundRobin(tokens, 4, node.id).map(f => ({
        logical_key: f.id,
        port_a: used[Number(f.a.kind === 'entry' ? f.a.entryId : -1)],
        port_b: used[Number(f.b.kind === 'entry' ? f.b.entryId : -1)],
      }));
      const actual = (await db.query('SELECT * FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(node), JSON.stringify({ seedAssignments: assignments })])).rows;
      assert.deepEqual(actual, expected, `round robin with ${count} occupied slots`);
    }
    for (let count = 2; count <= 16; count++) for (let split = 1; split < count; split++) {
      const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
      definition.schema_version = '2.0'; definition.registration.entry_type = 'singles';
      definition.registration.min_entries = definition.registration.max_entries = count;
      const ranks: GraphSource[] = Array.from({ length: count }, (_, i) => ({ kind: 'rank', node_id: 'source', rank: i + 1 }));
      const next: GraphNode = { id: 'next', module: 'cross_play@1', side_a: ranks.slice(0, split), side_b: ranks.slice(split) };
      definition.nodes = [
        { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
        { id: 'source', module: 'round_robin@2', inputs: ranks.map((_, i) => ({ kind: 'seed', seed: i + 1 })) }, next,
        { id: 'final', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'next', rank: 1 }, { kind: 'rank', node_id: 'next', rank: 2 }] },
        { id: 'places', module: 'placements@2', final: 'final' },
      ];
      const entries = ranks.map((_, i) => ({ id: `e${i}`, playerIds: [`p${i}`] }));
      const analysis = analyzeGraph(definition, entries, []);
      const expected = analysis.resolvedFixtures.filter(f => f.fixture.stageId === 'next').map(f => ({ logical_key: f.fixture.id, port_a: analysis.fixtureSources[f.fixture.id][0], port_b: analysis.fixtureSources[f.fixture.id][1] }));
      const actual = (await db.query('SELECT * FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(next), '{}'])).rows;
      assert.deepEqual(actual, expected, `cross play ${split} by ${count - split}`);
    }
    const node = { id: 'next', module: 'round_robin@2', inputs: [1, 2, 3, 4].map(rank => ({ kind: 'rank', node_id: 'source', rank })) };
    const ports = (await db.query<{ logical_key: string; a: string; b: string }>('SELECT logical_key,port_a::text a,port_b::text b FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(node), '{}'])).rows;
    const stage = randomUUID(), bindings: Record<string, string | null> = {};
    for (const source of new Set(ports.flatMap(port => [port.a, port.b]))) bindings[source] = randomUUID();
    const rounds = ports.map((_, index) => ({ id: randomUUID(), stage_id: stage, logical_wave: index + 1, status: 'pending', is_current: true, schedule_generation: 1 }));
    const matches = ports.map((port, index) => ({ id: randomUUID(), stage_id: stage, round_id: rounds[index].id, court_number: 1, schedule_generation: 1, logical_key: port.logical_key, team_a_id: bindings[port.a], team_b_id: bindings[port.b], status: 'scheduled', is_current: true, revision: 0, result_revision: 0, submit_to_dupr: false }));
    const validate = (fixtures: unknown[], waves: unknown[] = rounds) => db.query('SELECT tournament_builder_private.validate_graph_scheduled_fixtures($1::jsonb,$2::jsonb,$3::uuid,$4::jsonb,$5::jsonb,$6::jsonb,1,4)', [JSON.stringify(node), '{}', stage, JSON.stringify(fixtures), JSON.stringify(bindings), JSON.stringify(waves)]);
    await validate(matches);
    await assert.rejects(validate(matches.slice(1)), /INVALID_EFFECTS/);
    await assert.rejects(validate([...matches, matches[0]]), /INVALID_EFFECTS/);
    await assert.rejects(validate(matches.map((match, i) => i ? match : { ...match, team_a_id: randomUUID() })), /INVALID_EFFECTS/);
    await assert.rejects(validate(matches.map((match, i) => i ? match : { ...match, status: 'validated', outcome_kind: 'played' })), /INVALID_EFFECTS/);
    await assert.rejects(validate(matches.map((match, i) => i ? match : { ...match, court_number: 5 })), /INVALID_EFFECTS/);
    await assert.rejects(validate(matches, rounds.map((round, i) => i === 1 ? { ...round, logical_wave: 1 } : round)), /INVALID_EFFECTS/);
    await assert.rejects(validate(matches.map((match, i) => i === 2 ? { ...match, court_number: 2 } : match), rounds.map((round, i) => i === 2 ? { ...round, logical_wave: 1 } : round)), /INVALID_EFFECTS/);
    const event = randomUUID();
    await db.query('INSERT INTO public.tournament_stages(id,tournament_id,state,output) VALUES($1,$2,$3,$4::jsonb)', [stage, event, 'waiting', '{}']);
    for (const id of Object.values(bindings)) await db.query('INSERT INTO public.teams(id,tournament_id,entry_state) VALUES($1,$2,$3)', [id, event, 'approved']);
    const sourceKeys = (await db.query<{ key: string }>('SELECT value::text key FROM jsonb_array_elements($1::jsonb)', [JSON.stringify(node.inputs)])).rows.map(row => row.key);
    const ids = sourceKeys.map(key => bindings[key]!);
    const rows = ids.map(entryId => ({ entryId, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, pointsForInLosses: 0 }));
    const stagePatch = { id: stage, state: 'ready', input_revision: 0, output_revision: 9, output: { state: 'ready', entryIds: ids, rows, ties: [ids], inputRevision: 0, rankingDraws: [] }, blocked_code: null };
    const standingRows = ids.map(team_id => ({ id: randomUUID(), stage_id: stage, round_id: rounds[0].id, team_id, wins: 0, losses: 0, points_for: 0, points_against: 0, rank: 1, input_revision: 0, eligible: true, tie_group: ids.join(',') }));
    const validateGroup = (stageEffect: unknown, standings: unknown[], sourceBindings = bindings) => db.query('SELECT tournament_builder_private.validate_graph_empty_group($1::uuid,$2::jsonb,$3::jsonb,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,9)', [event, JSON.stringify(node), '{}', stage, JSON.stringify(stageEffect), JSON.stringify(standings), JSON.stringify(matches), JSON.stringify(sourceBindings)]);
    await validateGroup(stagePatch, standingRows);
    await assert.rejects(validateGroup({ ...stagePatch, state: 'completed' }, standingRows), /INVALID_EFFECTS/);
    await assert.rejects(validateGroup(stagePatch, standingRows.map((row, i) => i ? row : { ...row, rank: 2 })), /INVALID_EFFECTS/);
    await assert.rejects(validateGroup(stagePatch, standingRows.map((row, i) => i ? row : { ...row, tie_group: null })), /INVALID_EFFECTS/);
    await assert.rejects(validateGroup({ ...stagePatch, output: { ...stagePatch.output, rows: rows.map((row, i) => i ? row : { ...row, wins: 3 }) } }, standingRows), /INVALID_EFFECTS/);
    await assert.rejects(validateGroup(stagePatch, standingRows.slice(1)), /INVALID_EFFECTS/);
    const partialBindings = { ...bindings, [sourceKeys[3]]: null }, partialIds = ids.slice(0, 3);
    const waitingStage = { ...stagePatch, state: 'waiting', output: { ...stagePatch.output, state: 'waiting', entryIds: partialIds, rows: rows.slice(0, 3), ties: [partialIds] } };
    await validateGroup(waitingStage, standingRows.slice(0, 3).map(row => ({ ...row, tie_group: partialIds.join(',') })), partialBindings);
    const crossEvent = randomUUID(), crossDefinition = randomUUID(), crossStage = randomUUID(), crossMatch = randomUUID(), teamA = randomUUID(), teamB = randomUUID();
    const cross = { id: 'cross', module: 'cross_play@1', side_a: [{ kind: 'seed', seed: 1 }], side_b: [{ kind: 'seed', seed: 2 }] };
    const terminal = { id: 'terminal', module: 'match@1', inputs: [1, 2].map(rank => ({ kind: 'rank', node_id: 'cross', rank })) };
    await db.query('INSERT INTO public.tournament_stages(id,tournament_id,definition_id,node_id,state,output) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [crossStage, crossEvent, crossDefinition, 'cross', 'completed', JSON.stringify({ rows: [{ entryId: teamA }, { entryId: teamB }], ties: [] })]);
    for (const id of [teamA, teamB]) await db.query('INSERT INTO public.teams(id,tournament_id,entry_state) VALUES($1,$2,$3)', [id, crossEvent, 'approved']);
    await db.query('INSERT INTO public.matches(id,tournament_id,stage_id,is_current,status,outcome_kind,winner_team_id,team_a_id,team_b_id) VALUES($1,$2,$3,true,$4,$5,$6,$6,$7)', [crossMatch, crossEvent, crossStage, 'validated', 'played', teamA, teamB]);
    const resolve = () => db.query<{ value: Record<string, string | null> }>('SELECT tournament_builder_private.graph_resolve_bindings($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) value', [crossEvent, crossDefinition, JSON.stringify([cross, terminal]), JSON.stringify({ entryIds: [teamA, teamB] }), JSON.stringify(terminal)]);
    assert.deepEqual(Object.values((await resolve()).rows[0].value).sort(), [teamA, teamB].sort());
    await db.query('UPDATE public.matches SET status=$1 WHERE id=$2', ['scheduled', crossMatch]);
    await assert.rejects(resolve(), /INVALID_STATE/);
    const routeEvent = randomUUID(), routeDefinition = randomUUID(), feederStage = randomUUID(), poolStage = randomUUID(), feederId = randomUUID();
    const feeder = { id: 'feeder', module: 'match@1', inputs: [{ kind: 'seed', seed: 1 }, { kind: 'seed', seed: 2 }] };
    const routePool = { id: 'route_pool', module: 'round_robin@2', inputs: [{ kind: 'winner', node_id: 'feeder' }, { kind: 'seed', seed: 3 }, { kind: 'seed', seed: 4 }] };
    for (const [id, name] of [[feederStage, 'feeder'], [poolStage, 'route_pool']]) await db.query('INSERT INTO public.tournament_stages(id,tournament_id,definition_id,node_id,state,output) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [id, routeEvent, routeDefinition, name, 'waiting', '{}']);
    await db.query('INSERT INTO public.matches(id,tournament_id,stage_id,logical_key,is_current,status) VALUES($1,$2,$3,$4,true,$5)', [feederId, routeEvent, feederStage, 'feeder:match', 'validated']);
    const routeRoster = { entryIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()] };
    const routeFixtures = (await db.query<{ logical_key: string }>('SELECT logical_key FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(routePool), JSON.stringify(routeRoster)])).rows.map(row => ({ id: randomUUID(), logical_key: row.logical_key, stage_id: poolStage }));
    const routes = (poolNode: unknown, effects: unknown[]) => db.query('SELECT tournament_builder_private.validate_graph_routes($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb)', [routeEvent, routeDefinition, JSON.stringify([feeder, poolNode]), JSON.stringify(routeRoster), JSON.stringify(effects)]);
    await routes(routePool, routeFixtures);
    await assert.rejects(routes(routePool, [...routeFixtures, { id: feederId, bracket_next_winner_match_id: routeFixtures[0].id, bracket_winner_fills_side: 'a' }]), /INVALID_EFFECTS/);
    const pairPool = { ...routePool, inputs: routePool.inputs.slice(0, 2) };
    const pairKey = (await db.query<{ logical_key: string; port_a: { kind: string } }>('SELECT logical_key,port_a FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(pairPool), JSON.stringify(routeRoster)])).rows[0];
    const pairMatch = { id: randomUUID(), logical_key: pairKey.logical_key, stage_id: poolStage };
    const pairRoute = { id: feederId, bracket_next_winner_match_id: pairMatch.id, bracket_winner_fills_side: pairKey.port_a.kind === 'winner' ? 'a' : 'b' };
    await routes(pairPool, [pairMatch, pairRoute]);
    await assert.rejects(routes(pairPool, [pairMatch, { ...pairRoute, bracket_winner_fills_side: pairRoute.bracket_winner_fills_side === 'a' ? 'b' : 'a' }]), /INVALID_EFFECTS/);
    const bothPool = { ...routePool, inputs: [{ kind: 'winner', node_id: 'feeder' }, { kind: 'loser', node_id: 'feeder' }] };
    const bothPort = (await db.query<{ logical_key: string; port_a: { kind: string } }>('SELECT logical_key,port_a FROM tournament_builder_private.graph_fixture_ports($1::jsonb,$2::jsonb)', [JSON.stringify(bothPool), JSON.stringify(routeRoster)])).rows[0];
    const bothMatch = { id: randomUUID(), logical_key: bothPort.logical_key, stage_id: poolStage }, winnerSide = bothPort.port_a.kind === 'winner' ? 'a' : 'b';
    const bothRoutes = { id: feederId, bracket_next_winner_match_id: bothMatch.id, bracket_winner_fills_side: winnerSide, bracket_next_loser_match_id: bothMatch.id, bracket_loser_fills_side: winnerSide === 'a' ? 'b' : 'a' };
    await routes(bothPool, [bothMatch, bothRoutes]);
    await assert.rejects(routes(bothPool, [bothMatch, { ...bothRoutes, bracket_next_loser_match_id: randomUUID() }]), /INVALID_EFFECTS/);
  } finally { await db.close(); }
});
