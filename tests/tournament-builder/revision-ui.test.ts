import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canReviseTournament, RevisionEditor } from '../../components/tournament-builder/revision-editor';
import { GroupFinalization } from '../../components/tournament-builder/group-finalization';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';

const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
const base: CommandSnapshot = { event: { id: 'event', revision: 3, modular_state: 'active', name: 'New display name', court_name: 'New venue' }, definitions: [], teams: [{ id: 'team', name: 'Team One', entry_state: 'approved' }], team_members: [{ id: 'member', team_id: 'team', user_id: 'player', membership_status: 'active' }], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };

test('structural changes are blocked by any historical started or non-scheduled match', () => {
  assert.equal(canReviseTournament('active', [{ id: 'match', status: 'scheduled' }]), true);
  for (const match of [{ id: 'old', status: 'scheduled', started_at: '2026-01-01', active: false }, { id: 'old', status: 'void', active: false }, { id: 'old', status: 'completed' }]) assert.equal(canReviseTournament('active', [match]), false);
  assert.equal(canReviseTournament('completed', []), false);
});

test('after play only name venue and reason controls are available and display overrides are used', () => {
  const html = renderToStaticMarkup(createElement(RevisionEditor, { snapshot: { ...base, matches: [{ id: 'old', status: 'completed', active: false }] }, definition, disabled: false, run: async () => {} }));
  assert.match(html, /value="New display name"/);
  assert.match(html, /value="New venue"/);
  assert.match(html, /Fixtures and results are preserved/);
  assert.doesNotMatch(html, /Revised tournament definition|Review proposed revision|Approved teams/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Save name and venue/);
});

test('before play exposes existing roster edits and requires review before revision confirmation', () => {
  const html = renderToStaticMarkup(createElement(RevisionEditor, { snapshot: base, definition, disabled: false, run: async () => {} }));
  assert.match(html, /Team One/);
  assert.match(html, /Remove this entry/);
  assert.match(html, /do not record personal consent/);
  assert.match(html, /Review proposed revision/);
  assert.doesNotMatch(html, /Confirm reviewed revision and close registration/);
});

test('schedule generation requires an actual schedule preview even without group assignments', () => {
  const html = renderToStaticMarkup(createElement(GroupFinalization, { eventId: 'event', rosterRevision: 1, groups: [], entries: base.teams, reviewed: true, pending: false, onChange: () => {}, onGenerate: () => {} }));
  assert.match(html, /Preview matches and team rest/);
  assert.doesNotMatch(html, /Confirm reviewed schedule and generate matches|Lock reviewed roster and generate matches/);
});

test('pending entries can be explicitly removed to reduce capacity or switch entry type', () => {
  const html = renderToStaticMarkup(createElement(RevisionEditor, { snapshot: { ...base, teams: [...base.teams, { id: 'pending', name: 'Pending Pair', entry_state: 'pending' }] }, definition, disabled: false, run: async () => {} }));
  assert.match(html, /Remove pending entry Pending Pair/);
  assert.match(html, /Pending invitations count toward capacity/);
});

test('recorded score or outcome locks structural editing even if a legacy match still says scheduled', () => {
  assert.equal(canReviseTournament('ready', [{ id: 'legacy', status: 'scheduled', score_a: 0 }]), false);
  assert.equal(canReviseTournament('ready', [{ id: 'legacy', status: 'scheduled', outcome_kind: 'walkover' }]), false);
});


test('a retained pending invitation with old consent can accept revised rules', async () => {
  const { TournamentBuilder } = await import('../../components/tournament-builder/builder');
  const { previewDefinition } = await import('../../lib/tournament-builder/preview');
  const snapshot: CommandSnapshot = { ...base, event: { ...base.event!, modular_state: 'registration_open', definition_id: 'new-definition', created_by: 'owner' }, definitions: [{ id: 'new-definition', definition }], teams: [{ id: 'team', name: 'Pending Pair', entry_state: 'pending' }], team_members: [{ id: 'member', team_id: 'team', user_id: 'player', membership_status: 'pending', consented_at: '2026-01-01', consented_definition_id: 'old-definition' }] };
  const html = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: 'player', initialSnapshot: snapshot, initialPreview: previewDefinition(definition, 3), view: 'overview' }));
  assert.match(html, /Accept invitation for/);
  assert.match(html, /I accept the published rules/);
});
