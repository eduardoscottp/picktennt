import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateDraft, validateDefinition } from '../../lib/tournament-builder/validate';
import { MODULE_CATALOG, getCapabilities } from '../../lib/tournament-builder/catalog';

const fixture = () => JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
test('catalog describes precisely seven trusted versioned modules and three paths', () => {
  assert.equal(MODULE_CATALOG.length, 7);
  assert.equal(getCapabilities().compositions.length, 3);
  assert.ok(MODULE_CATALOG.every(module => module.questions.length && module.input && module.output));
});
test('accepts the complete documented example without changing input', () => {
  const input = fixture(); const original = JSON.stringify(input);
  const result = validateDefinition(input);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.definition, input);
  assert.equal(JSON.stringify(input), original);
});
test('partial drafts report missing decisions separately from invalid supplied rules', () => {
  const result = validateDraft({ event: { name: 'My event' } });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 0);
  assert.ok(result.missing_fields.some(issue => issue.field_path === 'event.timezone'));
  assert.ok(result.missing_fields.every(issue => issue.code === 'MISSING_FIELD'));
  assert.equal(result.definition, undefined);
});
test('partial graph prefixes and missing connections remain missing decisions', () => {
  const d = fixture(); d.nodes = [{ id: 'r', module: 'registration@1' }, { id: 'e', module: 'entries@1' }];
  const result = validateDraft(d);
  assert.equal(result.errors.length, 0, JSON.stringify(result));
  assert.ok(result.missing_fields.some(issue => issue.field_path === 'nodes[1].from'));
  assert.ok(result.missing_fields.some(issue => issue.field_path === 'nodes'));
});
test('unknown keys cannot hide behind Object prototype names', () => {
  const d = fixture(); d.event = JSON.parse(JSON.stringify(d.event).replace('{', '{"toString":42,'));
  assert.ok(validateDraft(d).errors.some(issue => issue.field_path === 'event.toString'));
});
test('rejects unknown properties recursively including authoritative server fields', () => {
  for (const mutate of [
    (d: ReturnType<typeof fixture>) => { d.owner_id = 'attacker'; },
    (d: ReturnType<typeof fixture>) => { d.event.champion = 'attacker'; },
    (d: ReturnType<typeof fixture>) => { d.policies.match.formula = 'code()'; },
    (d: ReturnType<typeof fixture>) => { d.nodes[0].config = { arbitrary: true }; },
  ]) { const d = fixture(); mutate(d); assert.ok(validateDraft(d).errors.length); }
});
test('enforces all three exact graph paths and their configuration', () => {
  const d = fixture();
  d.nodes = d.nodes.filter((n: ReturnType<typeof fixture>) => !['top', 'playoff'].includes(n.id));
  d.nodes.at(-1).from = 'rank'; assert.equal(validateDraft(d).valid, true);
  d.nodes = [{ id: 'r', module: 'registration@1' }, { id: 'e', module: 'entries@1', from: 'r' }, { id: 'b', module: 'elimination@1', from: 'e', config: { seeding: 'draw', bronze: false } }, { id: 'p', module: 'placements@1', from: 'b' }];
  assert.equal(validateDraft(d).valid, true);
  for (const mutate of [
    (x: ReturnType<typeof fixture>) => { x.nodes[2].from = 'p'; },
    (x: ReturnType<typeof fixture>) => { x.nodes[2].config.seeding = 'ranked'; },
    (x: ReturnType<typeof fixture>) => { x.nodes[1].id = 'r'; },
    (x: ReturnType<typeof fixture>) => { x.nodes[2].module = 'elimination@2'; },
    (x: ReturnType<typeof fixture>) => { x.nodes.push({ id: 'extra', module: 'placements@1', from: 'p' }); },
  ]) { const x = structuredClone(d); mutate(x); assert.ok(validateDraft(x).errors.length); }
});
test('validates timezones, offsets, actual dates, deadlines and publication clock', () => {
  for (const [field, value] of [['timezone', 'Unknown/Place'], ['starts_at', '2026-11-07T09:00:00-04:00'], ['starts_at', '2026-02-30T09:00:00-05:00'], ['expected_end_at', '2026-11-07T08:00:00-05:00']]) {
    const d = fixture(); d.event[field] = value; assert.ok(validateDraft(d).errors.length);
  }
  assert.equal(validateDefinition(fixture(), { publication: true, now: new Date('2026-11-07T00:00:00Z') }).valid, false);
  assert.equal(validateDefinition(fixture(), { publication: true, now: new Date('2026-10-28T00:00:00Z') }).valid, true);
});
test('rejects invalid scalar constraints, ranking and consent', () => {
  const changes = [
    (d: ReturnType<typeof fixture>) => { d.event.courts = 9; }, (d: ReturnType<typeof fixture>) => { d.event.name = ' '; },
    (d: ReturnType<typeof fixture>) => { d.registration.min_entries = 9; }, (d: ReturnType<typeof fixture>) => { d.registration.partner_consent = false; },
    (d: ReturnType<typeof fixture>) => { d.policies.match.cap = 15; }, (d: ReturnType<typeof fixture>) => { d.policies.match.games = 3; },
    (d: ReturnType<typeof fixture>) => { d.policies.ranking.order = ['points_for_desc', 'wins_desc']; },
    (d: ReturnType<typeof fixture>) => { d.policies.ranking.order.push('wins_desc'); },
    (d: ReturnType<typeof fixture>) => { d.nodes[4].config.count = 3; },
    (d: ReturnType<typeof fixture>) => { d.nodes[4].config = {}; },
  ];
  for (const change of changes) { const d = fixture(); change(d); assert.equal(validateDraft(d).valid, false); }
});
test('direct brackets allow capacity ranges containing a valid roster and reject impossible ranges', () => {
  const d = fixture();
  d.nodes = [{ id: 'r', module: 'registration@1' }, { id: 'e', module: 'entries@1', from: 'r' }, { id: 'b', module: 'elimination@1', from: 'e', config: { seeding: 'draw', bronze: false } }, { id: 'p', module: 'placements@1', from: 'b' }];
  d.registration.min_entries = 5; d.registration.max_entries = 8;
  assert.equal(validateDraft(d).valid, true);
  d.registration.max_entries = 7; assert.equal(validateDraft(d).valid, false);
  d.registration.min_entries = 2; d.registration.max_entries = 2; d.nodes[2].config.bronze = true;
  assert.equal(validateDraft(d).valid, false);
  d.registration.max_entries = 3;
  assert.equal(validateDraft(d).valid, false, 'Only possible direct roster is two, which cannot play bronze.');
});
test('qualification capacity and two-entry bronze are blocking, duration is only a warning', () => {
  const d = fixture(); d.registration.max_entries = 3; d.registration.min_entries = 2;
  assert.ok(validateDraft(d).errors.some(issue => issue.code === 'INVALID_ADVANCEMENT'));
  d.registration.max_entries = 8; d.nodes[4].config.count = 2; d.nodes[5].config.bronze = true;
  assert.equal(validateDraft(d).valid, false);
  const short = fixture(); short.event.expected_end_at = '2026-11-07T09:01:00-05:00';
  const result = validateDraft(short); assert.equal(result.valid, true); assert.ok(result.warnings.length);
});
test('unsupported qualifier count reports the advancement contract and allowed values', () => {
  const d = fixture(); d.nodes[4].config.count = 6;
  const issue = validateDraft(d).errors.find(issue => issue.field_path === 'nodes[4].config.count');
  assert.equal(issue?.code, 'INVALID_ADVANCEMENT');
  assert.match(issue?.message ?? '', /2.*4/);
});


