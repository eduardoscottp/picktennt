import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewNextStage } from '../../lib/tournament-builder/next-stage-preview';
import { previewCorrection, previewWithdrawal } from '../../lib/tournament-builder/corrections';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';

for (const { mode, count } of [{ mode: 'round_robin', count: 2 }, { mode: 'cross_play', count: 2 }, { mode: 'mixed', count: 2 }, { mode: 'same_feeder', count: 2 }, { mode: 'direct_seed', count: 3 }, { mode: 'round_robin', count: 3 }, { mode: 'cross_play', count: 4 }, { mode: 'round_robin', count: 5 }, { mode: 'cross_play', count: 5 }, { mode: 'round_robin', count: 8 }, { mode: 'cross_play', count: 8 }, ...[2, 3, 4, 5, 8, 16].map(count => ({ mode: 'rank_rr' as const, count })), { mode: 'rank_cross', count: 4 }, { mode: 'rank_cross_terminal', count: 4 }, { mode: 'rank_unqualified_withdrawal', count: 4 }, { mode: 'rank_qualified_withdrawal', count: 4 }, { mode: 'rank_terminal_zero', count: 4 }, { mode: 'rank_terminal_one', count: 4 }, { mode: 'rank_terminal_semis', count: 4 }, { mode: 'rank_terminal_cascade', count: 4 }, { mode: 'rank_terminal_two_cross', count: 4 }, { mode: 'rank_underfilled', count: 4 }, { mode: 'rank_groups', count: 4 }, { mode: 'rank_semis', count: 4 }] as const) test(`SQL verifies ${count} source positions feeding ${mode} and final`, async () => {
 const db = await storageDatabase();
 try {
  await db.exec(readFileSync('supabase/migrations/202611130003_graph_fixture_ports.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202611130004_graph_seed_pool_review.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202611130005_graph_general_review.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202611130006_graph_partial_auto_group.sql', 'utf8'));
  const actor = { id: owner, clientId: 'web' }, context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] }, event = randomUUID();
  const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8')) as GraphDefinition;
  definition.schema_version = '2.0'; definition.registration.mode = 'open'; definition.registration.entry_type = 'singles'; definition.registration.partner_consent = false;
  definition.registration.min_entries = definition.registration.max_entries = mode === 'direct_seed' ? 4 : mode.startsWith('rank_') || mode === 'same_feeder' ? count : count * 2;
  if (mode === 'rank_underfilled') definition.registration.max_entries = 5;
  const now = Date.now(); definition.event.timezone = 'UTC';
  definition.registration.closes_at = new Date(now + 30 * 86400000).toISOString(); definition.event.starts_at = new Date(now + 31 * 86400000).toISOString(); definition.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
  definition.nodes = [
   { id: 'registration', module: 'registration@1' }, { id: 'entries', module: 'entries@1', from: 'registration' },
   ...(mode === 'rank_cross' || mode === 'rank_cross_terminal' ? [{ id: 'source', module: 'cross_play@1' as const, side_a: [1, 2].map(seed => ({ kind: 'seed' as const, seed })), side_b: [3, 4].map(seed => ({ kind: 'seed' as const, seed })) }] : mode === 'rank_rr' || mode === 'rank_semis' || mode === 'rank_unqualified_withdrawal' || mode === 'rank_qualified_withdrawal' || mode.startsWith('rank_terminal_') || mode === 'rank_underfilled' ? [{ id: 'source', module: 'round_robin@2' as const, inputs: Array.from({ length: mode === 'rank_underfilled' ? 5 : count }, (_, i) => ({ kind: 'seed' as const, seed: i + 1 })) }] : mode === 'rank_groups' ? [0, 1].map(i => ({ id: `source${i}`, module: 'round_robin@2' as const, inputs: [i * 2 + 1, i * 2 + 2].map(seed => ({ kind: 'seed' as const, seed })) })) : Array.from({ length: mode === 'same_feeder' || mode === 'direct_seed' ? 1 : count }, (_, i) => ({ id: `feeder${i}`, module: 'match@1' as const, inputs: [i * 2 + 1, i * 2 + 2].map(seed => ({ kind: 'seed' as const, seed })) }))),
   ...(mode === 'rank_cross_terminal' ? [] : mode === 'direct_seed' ? [{ id: 'pool', module: 'round_robin@2' as const, inputs: [{ kind: 'winner' as const, node_id: 'feeder0' }, { kind: 'seed' as const, seed: 3 }, { kind: 'seed' as const, seed: 4 }] }] : mode === 'rank_terminal_two_cross' ? [{ id: 'pool', module: 'cross_play@1' as const, side_a: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: 'source', rank })), side_b: [3, 4].map(rank => ({ kind: 'rank' as const, node_id: 'source', rank })) }] : mode.startsWith('rank_') ? [{ id: 'pool', module: 'round_robin@2' as const, inputs: Array.from({ length: mode === 'rank_unqualified_withdrawal' ? 2 : count }, (_, i) => ({ kind: 'rank' as const, node_id: mode === 'rank_groups' ? `source${Math.floor(i / 2)}` : 'source', rank: mode === 'rank_groups' ? i % 2 + 1 : i + 1 })) }] : mode === 'round_robin' || mode === 'mixed' || mode === 'same_feeder'
    ? [{ id: 'pool', module: 'round_robin@2' as const, inputs: Array.from({ length: count }, (_, i) => ({ kind: (mode === 'mixed' || mode === 'same_feeder') && i === 1 ? 'loser' as const : 'winner' as const, node_id: `feeder${mode === 'same_feeder' ? 0 : i}` })) }]
    : [{ id: 'pool', module: 'cross_play@1' as const, side_a: Array.from({ length: Math.floor(count / 2) }, (_, i) => ({ kind: 'winner' as const, node_id: `feeder${i}` })), side_b: Array.from({ length: count - Math.floor(count / 2) }, (_, i) => ({ kind: 'winner' as const, node_id: `feeder${i + Math.floor(count / 2)}` })) }]),
   ...(mode === 'rank_terminal_cascade' ? [{ id: 'pool2', module: 'cross_play@1' as const, side_a: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })), side_b: [3, 4].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) }] : []),
   ...(mode === 'rank_semis' || mode === 'rank_terminal_semis' ? [
    { id: 's1', module: 'match@1' as const, inputs: [1, 4].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) },
    { id: 's2', module: 'match@1' as const, inputs: [2, 3].map(rank => ({ kind: 'rank' as const, node_id: 'pool', rank })) },
    { id: 'final', module: 'match@1' as const, inputs: ['s1', 's2'].map(node_id => ({ kind: 'winner' as const, node_id })) },
    { id: 'bronze', module: 'match@1' as const, inputs: ['s1', 's2'].map(node_id => ({ kind: 'loser' as const, node_id })) },
    { id: 'placements', module: 'placements@2' as const, final: 'final', bronze: 'bronze' },
   ] : [{ id: 'final', module: 'match@1' as const, inputs: [1, 2].map(rank => ({ kind: 'rank' as const, node_id: mode === 'rank_cross_terminal' ? 'source' : mode === 'rank_terminal_cascade' ? 'pool2' : 'pool', rank })) }, { id: 'placements', module: 'placements@2' as const, final: 'final' }]),
  ];
  const snapshot = async () => role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
  const run = async (name: string, request: Record<string, unknown>, initial?: CommandSnapshot) => {
   const before = initial ?? await snapshot(), plan = planCommand(before, actor, name, request, context);
   await command(db, { event, command: name, revision: before.event ? Number(before.event.revision) : null, request, effects: plan.effects, result: plan.result });
   return snapshot();
  };
  const empty: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  let current = await run('createDraft', { definition }, empty);
  const publication = previewDefinition(definition, Number(current.event!.revision));
  assert.equal(publication.valid, true);
  current = await run('publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes ?? [] });
  for (let i = 0; i < (mode === 'direct_seed' ? 4 : mode.startsWith('rank_') || mode === 'same_feeder' ? count : count * 2); i++) {
   const user = randomUUID();
   await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [user, `${user}@example.invalid`, JSON.stringify({ given_name: `Player ${i}` })]);
   current = await run('addRegisteredEntry', { definition_id: current.event!.definition_id, player_ids: [user], entry_name: `Player ${i}`, reason: 'Organizer enrolled verified player.' });
  }
  current = await run('closeRegistration', {}); current = await run('lockRoster', { reviewed_roster_revision: current.event!.roster_revision, ...(mode === 'rank_underfilled' ? { group_assignments: { source: current.teams.map(team => team.id) } } : {}) }); current = await run('startTournament', {});
  if (mode.startsWith('rank_')) {
   assert.equal(current.matches.length, mode === 'rank_groups' ? 2 : mode === 'rank_cross_terminal' || mode === 'rank_cross' ? 4 : count * (count - 1) / 2);
   const sourceIds = current.stages.filter(stage => String(stage.node_id).startsWith('source')).map(stage => String(stage.id));
   for (const match of current.matches.filter(match => sourceIds.includes(String(match.stage_id)))) {
    const a = Number(current.teams.find(team => team.id === match.team_a_id)!.seed), b = Number(current.teams.find(team => team.id === match.team_b_id)!.seed);
    const loserScore = Math.min(9, a + b);
    current = await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: a < b ? 11 : loserScore, score_b: a < b ? loserScore : 11, reason: 'Verified group result' });
   }
   if (mode.startsWith('rank_terminal_')) {
    const eligibleCount = mode === 'rank_terminal_zero' ? 0 : mode === 'rank_terminal_one' || mode === 'rank_terminal_semis' || mode === 'rank_terminal_cascade' ? 1 : 2;
    const withdrawn = current.teams.filter(team => Number(team.seed) > eligibleCount).map(team => team.id);
    for (const entry_id of withdrawn) {
     const request = { entry_id, reason: 'Withdrawn before automatic phase' }, impact = previewWithdrawal(current, actor, request);
     current = await run('withdrawEntry', { ...request, preview_hash: impact.preview_hash });
    }
    const review = previewNextStage(current, actor);
    assert.equal(review.state, 'ready');
    if (review.state !== 'ready') throw new Error('Expected reviewed terminal automatic outcomes');
    if (eligibleCount === 0) assert.ok('no_eligible_champion' in review && review.no_eligible_champion);
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    const group = definition.nodes.find(node => node.id === 'pool')!, groupStage = current.stages.find(stage => stage.node_id === 'pool')!, groupPatch = plan.effects.stages!.find(stage => stage.id === groupStage.id)!;
    const bindings = (await db.query<{ value: Record<string, string | null> }>('SELECT tournament_builder_private.graph_resolve_auto_group_bindings($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb) value', [event, current.event!.definition_id, JSON.stringify(definition.nodes), JSON.stringify(current.stages.find(stage => stage.module_id === 'entries')!.output), JSON.stringify(group)])).rows[0].value;
    const validateGroup = (effects: typeof plan.effects) => db.query('SELECT tournament_builder_private.validate_graph_partial_auto_group($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::uuid,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::bigint,$12::integer,$13::bigint,$14::jsonb,true)', [event, owner, JSON.stringify(group), JSON.stringify(current.stages.find(stage => stage.module_id === 'entries')!.output), groupStage.id, JSON.stringify(groupPatch), JSON.stringify(effects.standings), JSON.stringify(effects.matches), JSON.stringify(bindings), JSON.stringify(effects.rounds), current.event!.roster_revision, definition.event.courts, Number(current.event!.revision) + 1, JSON.stringify(definition.policies.ranking.order)]);
    await validateGroup(plan.effects);
    const altered = structuredClone(plan.effects); altered.matches!.find(match => match.stage_id === groupStage.id && match.outcome_kind)!.validated_by = randomUUID();
    await assert.rejects(validateGroup(altered), /INVALID_EFFECTS/);
    const final = definition.nodes.find(node => node.id === 'final')!, finalStage = current.stages.find(stage => stage.node_id === 'final')!, finalPatch = plan.effects.stages!.find(stage => stage.id === finalStage.id)!;
    const effective = (await db.query<{ value: { values: unknown; known: Record<string, boolean> } }>('SELECT tournament_builder_private.graph_effective_bindings($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) value', [event, current.event!.definition_id, JSON.stringify(definition.nodes), JSON.stringify(current.stages.find(stage => stage.module_id === 'entries')!.output), JSON.stringify(final), JSON.stringify(plan.effects.stages)])).rows[0].value;
    assert.ok(Object.values(effective.known).every(known => known === (eligibleCount !== 2)));
    const validateFinal = (effects: typeof plan.effects) => db.query('SELECT tournament_builder_private.validate_graph_auto_match($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::uuid,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::bigint,$12::integer,$13::bigint)', [event, owner, JSON.stringify(final), JSON.stringify(current.stages.find(stage => stage.module_id === 'entries')!.output), finalStage.id, JSON.stringify(finalPatch), JSON.stringify(effects.matches), JSON.stringify(effective.values), JSON.stringify(effective.known), JSON.stringify(effects.rounds), current.event!.roster_revision, definition.event.courts, Number(current.event!.revision) + 1]);
    await validateFinal(plan.effects);
    const badFinal = structuredClone(plan.effects), finalMatch = badFinal.matches!.find(match => match.logical_key === 'final:match')!;
    if (eligibleCount === 2) finalMatch.status = 'validated'; else finalMatch.validated_by = randomUUID();
    await assert.rejects(validateFinal(badFinal), /INVALID_EFFECTS/);
    const validateGeneral = (effects: unknown) => db.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify(request), JSON.stringify(effects)]);
    await validateGeneral(plan.effects);
    const badPlacement = structuredClone(plan.effects), placementStage = current.stages.find(stage => stage.node_id === 'placements')!;
    badPlacement.stages!.find(stage => stage.id === placementStage.id)!.output = { state: 'completed', championEntryId: randomUUID() };
    await assert.rejects(validateGeneral(badPlacement), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    const badEvent = structuredClone(plan.effects);
    badEvent.event = { ...(badEvent.event ?? {}), modular_state: 'completed', result_version: 99999 };
    await assert.rejects(validateGeneral(badEvent), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
    await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
    const after = await snapshot();
    if (eligibleCount === 1) assert.equal(after.event!.modular_state, 'completed');
    if (eligibleCount === 0) assert.equal(after.stages.find(stage => stage.node_id === 'placements')!.state, 'blocked');
    if (mode === 'rank_terminal_semis') assert.ok(after.matches.some(match => match.logical_key === 'bronze:match' && match.outcome_kind === 'no_contest'));
    if (mode === 'rank_terminal_cascade') assert.ok(after.matches.some(match => String(match.logical_key).startsWith('pool2:') && match.outcome_kind === 'walkover'));
    return;
   }
   if (mode === 'rank_qualified_withdrawal') {
    const last = current.teams.find(team => Number(team.seed) === count)!;
    const withdrawal = { entry_id: last.id, reason: 'Withdrawn after group' }, withdrawalReview = previewWithdrawal(current, actor, withdrawal);
    current = await run('withdrawEntry', { ...withdrawal, preview_hash: withdrawalReview.preview_hash });
    const review = previewNextStage(current, actor);
    assert.equal(review.state, 'ready');
    if (review.state !== 'ready') throw new Error('Expected review of automatic outcomes');
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    assert.ok(plan.effects.matches!.filter(match => match.outcome_kind === 'walkover').length >= 3);
    assert.ok(plan.effects.standings!.some(row => row.eligible === false));
    const validate = (effects: unknown) => db.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify(request), JSON.stringify(effects)]);
    await validate(plan.effects);
    const forged = structuredClone(plan.effects); forged.matches!.find(match => match.outcome_kind === 'walkover')!.winner_team_id = randomUUID();
    await assert.rejects(validate(forged), /UNSUPPORTED_FORMAT|INVALID_EFFECTS|INVALID_STATE/);
    const forgedScore = structuredClone(plan.effects); forgedScore.matches!.find(match => match.outcome_kind === 'walkover')!.score_a = 11;
    await assert.rejects(validate(forgedScore), /UNSUPPORTED_FORMAT|INVALID_EFFECTS|INVALID_STATE/);
    const forgedActor = structuredClone(plan.effects); forgedActor.matches!.find(match => match.outcome_kind === 'walkover')!.validated_by = randomUUID();
    await assert.rejects(validate(forgedActor), /UNSUPPORTED_FORMAT|INVALID_EFFECTS|INVALID_STATE/);
    const forgedStanding = structuredClone(plan.effects); forgedStanding.standings!.find(row => row.stage_id === current.stages.find(stage => stage.node_id === 'pool')!.id)!.wins = 99;
    await assert.rejects(validate(forgedStanding), /UNSUPPORTED_FORMAT|INVALID_EFFECTS|INVALID_STATE/);
    const forgedStage = structuredClone(plan.effects); forgedStage.stages!.find(stage => stage.id === current.stages.find(row => row.node_id === 'pool')!.id)!.state = 'completed';
    await assert.rejects(validate(forgedStage), /UNSUPPORTED_FORMAT|INVALID_EFFECTS|INVALID_STATE/);
    const probe = { id: 'probe', module: 'match@1', inputs: [{ kind: 'rank', node_id: 'pool', rank: 1 }, { kind: 'rank', node_id: 'pool', rank: 4 }] };
    const effective = (stages: unknown[]) => db.query<{ value: { values: Record<string, string | null>; known: Record<string, boolean> } }>('SELECT tournament_builder_private.graph_effective_bindings($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) value', [event, current.event!.definition_id, JSON.stringify([...definition.nodes, probe]), JSON.stringify(current.stages.find(stage => stage.module_id === 'entries')!.output), JSON.stringify(probe), JSON.stringify(stages)]);
    const pending = (await effective(plan.effects.stages!)).rows[0].value;
    assert.deepEqual(Object.values(pending.known), [false, false]);
    const completed = structuredClone(plan.effects.stages!), pool = completed.find(stage => stage.id === current.stages.find(row => row.node_id === 'pool')!.id)!;
    pool.state = 'completed'; (pool.output as Record<string, unknown>).ties = [];
    const resolved = (await effective(completed)).rows[0].value;
    assert.deepEqual(Object.values(resolved.known), [true, true]);
    assert.equal(Object.values(resolved.values).filter(value => value === null).length, 1);
    const before = await snapshot();
    await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
    const after = await snapshot();
    assert.equal(after.matches.filter(match => match.outcome_kind === 'walkover' && match.stage_id === after.stages.find(stage => stage.node_id === 'pool')!.id).length, 3);
    assert.equal(Number(after.event!.revision), Number(before.event!.revision) + 1);
    return;
   }
   if (mode === 'rank_unqualified_withdrawal') {
    const last = current.teams.find(team => Number(team.seed) === count)!;
    const withdrawal = { entry_id: last.id, reason: 'Withdrawn after group' }, withdrawalReview = previewWithdrawal(current, actor, withdrawal);
    current = await run('withdrawEntry', { ...withdrawal, preview_hash: withdrawalReview.preview_hash });
    const review = previewNextStage(current, actor);
    assert.equal(review.state, 'ready');
    if (review.state !== 'ready') throw new Error('Expected review with nonqualifier withdrawn');
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    const forged = structuredClone(plan.effects); forged.matches!.find(match => match.logical_key === 'pool:r1:m1')!.team_a_id = last.id;
    await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forged, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
    await command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: plan.effects, result: plan.result });
    assert.ok((await snapshot()).matches.some(match => match.logical_key === 'pool:r1:m1'));
    return;
   }
   if (mode === 'rank_cross_terminal') {
    const review = previewNextStage(current, actor);
    assert.equal(review.state, 'ready');
    if (review.state !== 'ready') throw new Error('Expected cross-play final review');
    const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context);
    const forged = structuredClone(plan.effects); forged.matches!.find(match => match.logical_key === 'final:match')!.team_a_id = randomUUID();
    await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forged, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
    current = await run('generateNextStage', request);
    const final = current.matches.find(match => match.logical_key === 'final:match')!;
    current = await run('attestScore', { match_id: final.id, outcome_kind: 'played', score_a: 11, score_b: 3, reason: 'Verified final result' });
    assert.equal(current.event!.modular_state, 'completed');
    return;
   }
  } else {
   assert.equal(current.matches.length, mode === 'same_feeder' || mode === 'direct_seed' ? 1 : count);
   assert.equal(previewNextStage(current, actor).state, 'blocked');
   for (const match of current.matches) current = await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: 11, score_b: 3, reason: 'Verified result' });
  }
  const review = previewNextStage(current, actor);
  assert.equal(review.state, 'ready');
  if (review.state !== 'ready') throw new Error('Expected review');
  const groupGames = mode === 'cross_play' ? Math.floor(count / 2) * Math.ceil(count / 2) : count * (count - 1) / 2;
  assert.equal(review.fixtures.length, groupGames + (mode === 'rank_semis' ? 4 : 1));
  const request = { preview_hash: review.preview_hash }, plan = planCommand(current, actor, 'generateNextStage', request, context), before = await snapshot();
  const forged = structuredClone(plan.effects);
  forged.matches!.find(match => match.logical_key === 'pool:r1:m1')!.team_a_id = randomUUID();
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forged, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  const forgedRank = structuredClone(plan.effects);
  forgedRank.standings![0].rank = 2;
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forgedRank, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  const forgedResult = structuredClone(plan.effects);
  Object.assign(forgedResult.matches!.find(match => match.logical_key === 'pool:r1:m1')!, { status: 'validated', winner_team_id: current.teams[0].id });
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forgedResult, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  const forgedWave = structuredClone(plan.effects);
  forgedWave.rounds!.find(round => round.stage_id === current.stages.find(stage => stage.node_id === 'final')!.id)!.logical_wave = 1;
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forgedWave, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  const forgedStage = structuredClone(plan.effects);
  forgedStage.stages!.find(stage => stage.id === current.stages.find(row => row.node_id === 'pool')!.id)!.state = 'completed';
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forgedStage, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  const forgedReference = structuredClone(plan.effects);
  forgedReference.matches!.find(match => match.logical_key === 'pool:r1:m1')!.round_id = randomUUID();
  await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forgedReference, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  const validateGeneral = (effects: unknown) => db.query('SELECT tournament_builder_private.validate_graph_general_no_auto($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)', [owner, event, JSON.stringify(request), JSON.stringify(effects)]);
  await validateGeneral(plan.effects);
  for (const invalid of [forged, forgedRank, forgedResult, forgedWave, forgedStage, forgedReference]) await assert.rejects(validateGeneral(invalid), /INVALID_EFFECTS|INVALID_STATE|UNSUPPORTED_FORMAT/);
  if (mode === 'rank_semis') {
   const forgedLink = structuredClone(plan.effects);
   forgedLink.matches!.find(match => match.logical_key === 's1:match')!.bracket_next_loser_match_id = randomUUID();
   await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: forgedLink, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
   const collision = structuredClone(plan.effects), left = collision.matches!.find(match => match.logical_key === 's1:match')!, right = collision.matches!.find(match => match.logical_key === 's2:match')!;
   right.court_number = left.court_number;
   collision.rounds!.find(round => round.id === right.round_id)!.logical_wave = collision.rounds!.find(round => round.id === left.round_id)!.logical_wave;
   await assert.rejects(command(db, { event, command: 'generateNextStage', revision: Number(current.event!.revision), request, effects: collision, result: plan.result }), /INVALID_EFFECTS|UNSUPPORTED_FORMAT/);
  }
  assert.deepEqual(await snapshot(), before);
  current = await run('generateNextStage', request);
  assert.equal(current.matches.filter(match => match.is_current !== false).length, (mode === 'rank_rr' || mode === 'rank_semis' || mode === 'rank_underfilled' ? count * (count - 1) / 2 : mode === 'rank_groups' ? 2 : mode === 'rank_cross' ? 4 : mode === 'same_feeder' || mode === 'direct_seed' ? 1 : count) + groupGames + (mode === 'rank_semis' ? 4 : 1));
  assert.equal(current.standings.filter(row => row.stage_id === current.stages.find(stage => stage.node_id === 'pool')!.id).length, count);
  const poolMatch = current.matches.find(match => match.logical_key === 'pool:r1:m1')!;
  const final = current.matches.find(match => match.logical_key === 'final:match')!;
  current = await run('attestScore', { match_id: poolMatch.id, outcome_kind: 'played', score_a: 11, score_b: 3, reason: 'Verified group result' });
  const feeder = current.matches.find(match => match.logical_key === (mode === 'rank_rr' || mode === 'rank_semis' || mode === 'rank_cross' || mode === 'rank_underfilled' ? 'source:r1:m1' : mode === 'rank_groups' ? 'source0:r1:m1' : 'feeder0:match'))!;
  const correction = { match_id: feeder.id, score_a: feeder.score_b, score_b: feeder.score_a }, correctionReview = previewCorrection(current, actor, correction);
  assert.ok(correctionReview.affected_match_ids.includes(poolMatch.id));
  assert.ok(correctionReview.affected_match_ids.includes(final.id));
  current = await run('commitCorrection', { ...correction, preview_hash: correctionReview.preview_hash, reason: 'Correct verified feeder score', resolution: 'void_and_replay' });
  assert.equal(current.matches.find(match => match.id === poolMatch.id)!.is_current, false);
  assert.equal(current.matches.filter(match => match.logical_key === 'pool:r1:m1' && match.is_current !== false).length, 1);
  if (mode === 'rank_semis') {
   for (let i = 0; i < 10 && current.event!.modular_state !== 'completed'; i++) {
    const match = current.matches.find(row => row.is_current !== false && !row.voided_at && row.status === 'scheduled' && row.team_a_id && row.team_b_id);
    assert.ok(match, `A playable group, semifinal, bronze, or final must exist: ${JSON.stringify(current.stages.map(stage => ({ node: stage.node_id, state: stage.state, output: stage.output })))}`);
    const a = Number(current.teams.find(team => team.id === match.team_a_id)!.seed), b = Number(current.teams.find(team => team.id === match.team_b_id)!.seed);
    current = await run('attestScore', { match_id: match.id, outcome_kind: 'played', score_a: a < b ? 11 : 3, score_b: a < b ? 3 : 11, reason: 'Verified final-stage result' });
   }
   assert.equal(current.event!.modular_state, 'completed');
   const winner = current.matches.find(match => match.logical_key === 'final:match' && match.is_current !== false)!.winner_team_id;
   const placement = current.stages.find(stage => stage.module_id === 'placements')!.output as { championEntryId: string };
   assert.equal(placement.championEntryId, winner);
   assert.equal(current.matches.find(match => match.logical_key === 'bronze:match' && match.is_current !== false)!.status, 'validated');
  }
 } finally { await db.close(); }
});
