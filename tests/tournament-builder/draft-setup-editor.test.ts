import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TournamentBuilder } from '../../components/tournament-builder/builder';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import { graphSourceLabel } from '../../components/tournament-builder/graph-review';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { applyDraftSetupEdit, draftSetupError, eventTimestamp, DraftSetupEditor } from '../../components/tournament-builder/draft-setup-editor';

export function incompleteSetup() {
  const d = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  delete d.event.expected_end_at;
  delete d.registration.closes_at;
  delete d.registration.partner_consent;
  delete d.registration.organizer_plays;
  delete d.scheduling;
  return d;
}

test('the reported missing fields have visible required inputs with inline red accessible errors', () => {
  const d = incompleteSetup();
  const snapshot: CommandSnapshot = { event: { id: 'draft', created_by: 'owner', modular_state: 'draft', revision: 5, definition_id: 'def' }, definitions: [{ id: 'def', definition: d }], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  const html = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: 'owner', initialSnapshot: snapshot, initialPreview: previewDefinition(d, 5) }));
  for (const path of ['event.expected_end_at', 'registration.closes_at', 'registration.partner_consent', 'registration.organizer_plays', 'scheduling.estimated_slot_minutes', 'scheduling.minimum_rest_minutes', 'scheduling.contingency_minutes']) {
    const id = `draft-${path.replaceAll('.', '-')}`;
    assert.match(html, new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*aria-invalid="true"`), path);
    assert.ok(html.includes(`id="${id}-error"`), path);
  }
  assert.match(html, /Expected finish/);
  assert.match(html, /Registration closes/);
  assert.match(html, /Partner consent/);
  assert.match(html, /Will the organizer play/);
  assert.match(html, /Match slot \(minutes\)/);
  assert.match(html, /text-red-/);
  assert.match(html, /href="#draft-event-expected_end_at"/);
  assert.match(html, /fieldset disabled=""[^>]*>[\s\S]*Approve rules and open registration/);
});

test('placeholder source labels use Team N while seed references retain their meaning', () => {
  const source = { kind: 'seed', seed: 2 };
  assert.equal(graphSourceLabel(source, {}), 'Team 2');
  assert.deepEqual(source, { kind: 'seed', seed: 2 });
});

test('filling the reported controls repairs the draft without inventing enrollment or changing its format', () => {
  const original = incompleteSetup();
  const finish = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  let edited = applyDraftSetupEdit(original, 'event.expected_end_at', finish.event.expected_end_at.slice(0, 16));
  edited = applyDraftSetupEdit(edited, 'registration.closes_at', finish.registration.closes_at.slice(0, 16));
  edited = applyDraftSetupEdit(edited, 'registration.partner_consent', 'true');
  edited = applyDraftSetupEdit(edited, 'registration.organizer_plays', 'false');
  edited = applyDraftSetupEdit(edited, 'scheduling.estimated_slot_minutes', '30');
  edited = applyDraftSetupEdit(edited, 'scheduling.minimum_rest_minutes', '0');
  edited = applyDraftSetupEdit(edited, 'scheduling.contingency_minutes', '30');
  assert.equal(previewDefinition(edited, 6).valid, true);
  assert.equal(draftSetupError(edited, 'registration.organizer_plays'), undefined);
  assert.equal(draftSetupError(edited, 'scheduling.minimum_rest_minutes'), undefined);
  assert.deepEqual(edited.nodes, original.nodes);
  assert.equal(edited.policies, original.policies);
  assert.equal(original.event.expected_end_at, undefined);
  assert.equal(original.registration.partner_consent, undefined);
  assert.equal(original.scheduling, undefined);
  const html = renderToStaticMarkup(createElement(DraftSetupEditor, { definition: edited, savedDefinition: original, issues: previewDefinition(original, 5).missing_fields, disabled: false, onChange: () => {} }));
  assert.doesNotMatch(html, /aria-invalid="true"/);
});

test('clearing numeric and boolean fields restores missing decisions instead of defaulting to zero or false', () => {
  let d = applyDraftSetupEdit({}, 'scheduling.minimum_rest_minutes', '0');
  d = applyDraftSetupEdit(d, 'registration.organizer_plays', 'false');
  assert.equal(draftSetupError(d, 'scheduling.minimum_rest_minutes'), undefined);
  assert.equal(draftSetupError(d, 'registration.organizer_plays'), undefined);
  d = applyDraftSetupEdit(d, 'scheduling.minimum_rest_minutes', '');
  d = applyDraftSetupEdit(d, 'registration.organizer_plays', '');
  assert.match(draftSetupError(d, 'scheduling.minimum_rest_minutes')!, /required/);
  assert.match(draftSetupError(d, 'registration.organizer_plays')!, /required/);
});

test('date pickers use the event timezone across daylight saving, reject skipped times and preserve repeated-hour offsets', () => {
  assert.equal(eventTimestamp('2030-07-01T09:30', 'America/New_York'), '2030-07-01T09:30:00-04:00');
  assert.equal(eventTimestamp('2030-12-01T09:30', 'America/New_York'), '2030-12-01T09:30:00-05:00');
  assert.equal(eventTimestamp('2030-03-10T02:30', 'America/New_York'), undefined);
  assert.equal(eventTimestamp('2030-11-03T01:30', 'America/New_York', '2030-11-03T01:00:00-05:00'), '2030-11-03T01:30:00-05:00');
  assert.equal(eventTimestamp('2030-02-30T09:30', 'America/New_York'), undefined);
  const next = applyDraftSetupEdit({ event: { starts_at: '2030-07-01T09:30:00-04:00', timezone: 'America/New_York' } }, 'event.timezone', 'America/Chicago');
  assert.equal((next.event as Record<string, unknown>).starts_at, '2030-07-01T09:30:00-05:00');
});
