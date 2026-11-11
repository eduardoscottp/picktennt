import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase, role, command, owner } from './helpers/storage-db';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { previewBulkOperation } from '../../lib/tournament-builder/bulk-adjudication';
import { previewRevision } from '../../lib/tournament-builder/revisions';
import { previewCorrection } from '../../lib/tournament-builder/corrections';

let db: PGlite;
before(async () => { db = await storageDatabase(); });
after(async () => { await db?.close(); });
const actor = { id: owner, clientId: 'web' };
const context = { now: '2026-10-29T00:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
const empty = (): CommandSnapshot => ({ event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] });
async function snapshot(event: string) {
  return role(db, 'service_role', owner, async () => (await db.query<{ value: CommandSnapshot }>('SELECT public.tb_get_snapshot($1,$2,$3,$4) value', [owner, 'web', event, null])).rows[0].value);
}
async function apply(event: string, name: string, data: Record<string, unknown>, initial?: CommandSnapshot, commandActor = actor) {
  const current = initial ?? await snapshot(event);
  const plan = planCommand(current, commandActor, name, data, context);
  await command(db, { actor: commandActor.id, event, command: name, revision: current.event ? Number(current.event.revision) : null, request: data, effects: plan.effects, result: plan.result });
  return snapshot(event);
}

test('actual SQL persists and completes a 16-doubles graph through all 27 results, fencing stale writes', async () => {
  const event = randomUUID();
  const definition = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
  definition.registration.mode = 'open';
  const now = Date.now();
  definition.event.timezone = 'UTC';
  definition.registration.closes_at = new Date(now + 30 * 86400000).toISOString();
  definition.event.starts_at = new Date(now + 31 * 86400000).toISOString();
  definition.event.expected_end_at = new Date(now + 31 * 86400000 + 4 * 3600000).toISOString();
  let current = await apply(event, 'createDraft', { definition }, empty());
  assert.equal(current.definitions[0].schema_version, 2);
  assert.equal((current.definitions[0].definition as { schema_version: string }).schema_version, '2.0');
  const preview = previewDefinition(definition, Number(current.event!.revision));
  assert.equal(preview.valid, true);
  current = await apply(event, 'publishTournament', { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes ?? [] });
  const definitionId = String(current.event!.definition_id);
  const users = Array.from({ length: 32 }, () => randomUUID());
  for (let index = 0; index < users.length; index++) await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [users[index], `graph-${index}@example.invalid`, JSON.stringify({ given_name: `Graph Player ${index + 1}` })]);
  assert.equal(Number((await db.query<{ n: number }>('SELECT count(*) n FROM profiles WHERE id=ANY($1::uuid[])', [users])).rows[0].n), 32);
  for (const userId of users) current = await apply(event, 'joinTournament', { definition_id: definitionId, consent: true }, undefined, { id: userId, clientId: 'web' });
  for (let index = 0; index < 16; index++) current = await apply(event, 'addRegisteredEntry', { definition_id: definitionId, player_ids: users.slice(index * 2, index * 2 + 2), entry_name: `Pair ${index + 1}`, reason: 'Organizer enrolled verified Picktennt profiles.' });
  assert.equal(current.teams.length, 16);
  assert.equal(current.team_members.length, 32);
  assert.ok(current.team_members.every(member => member.admission_source === 'administrator' && member.consented_at === null));

  const stale = current;
  const stalePlan = planCommand(stale, actor, 'closeRegistration', {}, context);
  current = await apply(event, 'closeRegistration', {});
  const operation = randomUUID(), before = await snapshot(event);
  const operationCount = (await db.query('SELECT count(*) n FROM tournament_operations WHERE tournament_id=$1', [event])).rows[0];
  await assert.rejects(command(db, { event, operation, command: 'closeRegistration', revision: Number(stale.event!.revision), request: {}, effects: stalePlan.effects, result: stalePlan.result }), /STALE_REVISION/);
  assert.deepEqual(await snapshot(event), before);
  assert.deepEqual((await db.query('SELECT count(*) n FROM tournament_operations WHERE tournament_id=$1', [event])).rows[0], operationCount);
  assert.equal(Number((await db.query<{ n: number }>('SELECT count(*) n FROM tournament_operations WHERE operation_id=$1', [operation])).rows[0].n), 0);

  const oldDefinition = current.event!.definition_id, oldStages = current.stages.map(stage => stage.id);
  const revisionData = { definition, entries: [], reason: 'Review graph before generating' };
  const revisionReview = previewRevision(current, actor, revisionData);
  current = await apply(event, 'reviseTournament', { ...revisionData, preview_hash: revisionReview.preview_hash });
  assert.notEqual(current.event!.definition_id, oldDefinition);
  assert.ok(current.stages.every(stage => stage.definition_id === current.event!.definition_id && !oldStages.includes(stage.id)));
  assert.equal((await db.query('SELECT id FROM tournament_stages WHERE id=ANY($1::uuid[])', [oldStages])).rows.length, oldStages.length);

  current = await apply(event, 'lockRoster', { reviewed_roster_revision: current.event!.roster_revision });
  current = await apply(event, 'startTournament', {});
  assert.equal(current.matches.length, 27);
  assert.equal(new Set(current.rounds.map(round => Number(round.round_number))).size, current.rounds.length, 'Legacy SQL requires globally unique round numbers');
  const poolA = current.stages.find(stage => stage.node_id === 'A')!;
  const poolMatches = current.matches.filter(match => match.stage_id === poolA.id);
  const poolTeams = current.teams.filter(team => poolMatches.some(match => [match.team_a_id, match.team_b_id].includes(team.id)));
  const entry = poolTeams.sort((a, b) => Number(b.seed) - Number(a.seed))[0];
  const selected = poolMatches.filter(match => [match.team_a_id, match.team_b_id].includes(entry.id)).slice(0, 2);
  const first = selected[0];
  current = await apply(event, 'attestScore', { match_id: first.id, outcome_kind: 'played', score_a: first.team_a_id === entry.id ? 2 : 11, score_b: first.team_b_id === entry.id ? 2 : 11, reason: 'Existing verified result.' });
  const saved = current.matches.find(match => match.id === first.id)!;
  assert.equal(previewCorrection(current, actor, { match_id: saved.id, outcome_kind: 'played', score_a: saved.score_b, score_b: saved.score_a }).source_match_id, saved.id);
  const proposal = { entry_id: entry.id, match_ids: selected.map(match => match.id), mode: 'score', winner_score: 11, loser_score: 0, reason: 'Administrative score review', overwrite_existing: true, regenerate_downstream: false };
  const reviewed = previewBulkOperation(current, actor, proposal);
  const data = { ...proposal, preview_hash: reviewed.preview_hash };
  const plan = planCommand(current, actor, 'bulkAdjudicate', data, context);
  const bulkOperation = randomUUID(), revision = Number(current.event!.revision);
  const bad = structuredClone(plan.effects);
  bad.matches!.find(match => match.id === first.id)!.winner_team_id = entry.id;
  await assert.rejects(command(db, { event, operation: bulkOperation, command: 'bulkAdjudicate', revision, request: data, effects: bad, result: plan.result }), /INVALID_EFFECTS/);
  assert.equal(Number((await snapshot(event)).event!.revision), revision);
  const receipt = await command(db, { event, operation: bulkOperation, command: 'bulkAdjudicate', revision, request: data, effects: plan.effects, result: plan.result });
  assert.deepEqual(await command(db, { event, operation: bulkOperation, command: 'bulkAdjudicate', revision, request: data, effects: plan.effects, result: plan.result }), receipt);
  current = await snapshot(event);
  assert.ok(selected.every(match => current.matches.find(saved => saved.id === match.id)?.outcome_kind === 'administrative_score'));
  assert.ok(selected.every(match => current.matches.find(saved => saved.id === match.id)?.submit_to_dupr === false));
  const history = await db.query<{ before_facts: CommandSnapshot; after_facts: CommandSnapshot; reason: string }>('SELECT before_facts,after_facts,reason FROM tournament_operations WHERE operation_id=$1', [bulkOperation]);
  assert.equal(history.rows[0].reason, proposal.reason);
  assert.equal(history.rows[0].before_facts.matches.find(match => match.id === first.id)?.outcome_kind, 'played');
  assert.equal(history.rows[0].after_facts.matches.find(match => match.id === first.id)?.outcome_kind, 'administrative_score');
  const regeneration = { entry_id: entry.id, match_ids: [first.id], mode: 'walkover', reason: 'Reviewed withdrawal and dependent schedule', overwrite_existing: true, regenerate_downstream: true };
  const regenPreview = previewBulkOperation(current, actor, regeneration);
  assert.ok(regenPreview.archived_matches.length > 0);
  const regenData = { ...regeneration, preview_hash: regenPreview.preview_hash };
  const regenPlan = planCommand(current, actor, 'bulkAdjudicate', regenData, context);
  const forged = structuredClone(regenPlan.effects);
  const unrelated = poolMatches.find(match => !selected.some(choice => choice.id === match.id))!;
  forged.matches!.push({ id: unrelated.id, is_current: false, voided_at: context.now });
  await assert.rejects(command(db, { event, command: 'bulkAdjudicate', revision: Number(current.event!.revision), request: regenData, effects: forged, result: regenPlan.result }), /INVALID_EFFECTS/);
  current = await apply(event, 'bulkAdjudicate', regenData);
  assert.ok(regenPreview.archived_matches.every(match => current.matches.find(saved => saved.id === match.match_id)?.is_current === false));
  assert.ok(regenPreview.changed_fixtures.filter(match => match.new_fixture).every(match => current.matches.find(saved => saved.id === match.match_id)?.is_current !== false));
  let played = 2;
  while (current.event!.modular_state !== 'completed') {
    assert.ok(played < 27, 'Graph must complete within its 27 matches');
    const match = current.matches.find(match => match.status === 'scheduled' && match.team_a_id && match.team_b_id);
    assert.ok(match, 'Stored graph must expose an eligible next match');
    if (match.logical_key === 'F:match') {
      const leaders = current.teams.filter(team => poolMatches.some(game => [game.team_a_id,game.team_b_id].includes(team.id))).sort((a,b)=>Number(a.seed)-Number(b.seed));
      const selectedEntry = leaders[0].id, low = leaders.at(-1)!.id;
      assert.ok([match.team_a_id,match.team_b_id].includes(selectedEntry));
      const source = current.matches.find(game=>game.stage_id===poolA.id&&[game.team_a_id,game.team_b_id].includes(selectedEntry)&&[game.team_a_id,game.team_b_id].includes(low))!;
      const combined = { entry_id:selectedEntry,match_ids:[source.id,match.id],mode:'score',winner_score:11,loser_score:9,reason:'Reviewed dependent games',overwrite_existing:true,regenerate_downstream:false };
      const impact = previewBulkOperation(current,actor,combined);
      current = await apply(event,'bulkAdjudicate',{...combined,preview_hash:impact.preview_hash});
      assert.equal(current.matches.find(game=>game.id===match.id)?.outcome_kind,'administrative_score');
      played++;
      continue;
    }
    const a = Number(current.teams.find(team => team.id === match.team_a_id)!.seed), b = Number(current.teams.find(team => team.id === match.team_b_id)!.seed);
    current = await apply(event, 'attestScore', { match_id: match.id, outcome_kind: 'played', score_a: a < b ? 11 : 2, score_b: a < b ? 2 : 11, reason: 'Organizer observed this completed game.' });
    played++;
  }
  assert.equal(played, 27);
  assert.equal(current.matches.filter(match => match.is_current !== false && ['validated', 'walkover'].includes(String(match.status))).length, 27);
  const pools = current.stages.filter(stage => stage.module_id === 'round_robin');
  assert.deepEqual(pools.map(stage => stage.node_id).sort(), ['A', 'B', 'C', 'D']);
  for (const pool of pools) {
    assert.equal(pool.state, 'completed');
    assert.equal(current.standings.filter(row => row.stage_id === pool.id).length, 4);
    assert.equal((pool.output as { rows: unknown[] }).rows.length, 4);
  }
  const placements = current.stages.find(stage => stage.module_id === 'placements')!;
  assert.equal(placements.state, 'completed');
  const groups = (placements.output as { groups: { rank: number; entryIds: string[] }[] }).groups;
  assert.equal(new Set(groups.flatMap(group => group.entryIds)).size, 16);
  assert.equal(groups.find(group => group.rank === 1)!.entryIds[0], current.matches.find(match => match.logical_key === 'F:match' && match.is_current !== false)!.winner_team_id);
  assert.equal((current.definitions.find(row => row.id === definitionId)!.definition as { schema_version: string }).schema_version, '2.0');
});
