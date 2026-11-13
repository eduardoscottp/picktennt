import assert from 'node:assert/strict';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { OverallPositions } from '../../components/tournament-builder/overall-positions';
import { TournamentBuilder } from '../../components/tournament-builder/builder';
import { ToastProvider } from '../../components/ui/toast';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { previewDefinition } from '../../lib/tournament-builder/preview';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';

const definition = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
function standingsSnapshot(graph: boolean, completed: boolean): CommandSnapshot & { caller_role: string } {
  const d = structuredClone(definition);
  if (graph) {
    d.schema_version = '2.0';
    d.nodes = [{ id: 'groupA', module: 'round_robin@2', inputs: [] }, { id: 'groupB', module: 'round_robin@2', inputs: [] }, { id: 'F', module: 'match@1', inputs: [] }, { id: 'places', module: 'placements@2', final: 'F' }];
  }
  return {
    caller_role: 'owner', event: { id: 'event', created_by: 'owner', definition_id: 'definition', revision: 4, modular_state: completed ? 'completed' : 'active' },
    definitions: [{ id: 'definition', definition: d }],
    teams: [{ id: 'a', name: 'Leader', entry_state: 'approved' }, { id: 'b', name: 'Underdog', entry_state: 'approved' }, { id: 'c', name: 'Third', entry_state: 'approved' }],
    team_members: [], tournament_players: [],
    standings: [{ id: 'one', stage_id: graph ? 'group-a-stage' : 'rank-stage', team_id: 'a', rank: 1, wins: 6, losses: 1, points_for: 70, points_against: 20 }, { id: 'two', stage_id: graph ? 'group-b-stage' : 'rank-stage', team_id: 'b', rank: graph ? 1 : 4, wins: 2, losses: 5, points_for: 30, points_against: 50 }, { id: 'three', stage_id: graph ? 'group-b-stage' : 'rank-stage', team_id: 'c', rank: 2, wins: 3, losses: 4, points_for: 40, points_against: 45 }],
    stages: graph ? [
      { id: 'group-a-stage', node_id: 'groupA', module_id: 'round_robin', module_version: 2 },
      { id: 'group-b-stage', node_id: 'groupB', module_id: 'round_robin', module_version: 2 },
      { id: 'final-stage', node_id: 'F', module_id: 'match' },
      { id: 'placement', node_id: 'places', module_id: 'placements', state: completed ? 'completed' : 'waiting', output: completed ? { state: 'completed', championEntryId: 'b', groups: [{ rank: 1, entryIds: ['b'] }, { rank: 2, entryIds: ['a'] }] } : {} },
    ] : [
      { id: 'rank-stage', node_id: 'rank', module_id: 'standings' },
      { id: 'placement', node_id: 'result', module_id: 'placements', state: completed ? 'completed' : 'waiting', output: completed ? { state: 'completed', championEntryId: 'b', groups: [{ rank: 1, entryIds: ['b'] }, { rank: 2, entryIds: ['a'] }] } : {} },
    ],
    rounds: [{ id: 'gold', round_type: 'finals_gold' }],
    matches: [{ id: 'final', stage_id: 'final-stage', logical_key: graph ? 'F:match' : 'playoff:r2:m1', round_id: 'gold', status: completed ? 'validated' : 'scheduled', outcome_kind: completed ? 'played' : null, team_a_id: 'a', team_b_id: 'b', winner_team_id: completed ? 'b' : null }],
  };
}
function renderStandings(snapshot: CommandSnapshot & { caller_role: string }) {
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test' };
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, createElement(TournamentBuilder, { actorId: 'owner', initialSnapshot: snapshot, initialPreview: previewDefinition(definition, 4), view: 'standings' }))));
}

test('overall positions label undecided ranks and do not call preliminary standings final', () => {
  const snapshot: CommandSnapshot = {
    event: { id: 't', definition_id: 'd', modular_state: 'active' }, definitions: [{ id: 'd', definition: { schema_version: '1.0', nodes: [] } }],
    teams: [{ id: 'a', entry_state: 'approved' }, { id: 'b', entry_state: 'approved' }], team_members: [], tournament_players: [], standings: [],
    stages: [{ id: 'p', module_id: 'placements', state: 'waiting' }], rounds: [{ id: 'r', round_type: 'finals_gold' }],
    matches: [{ id: 'f', round_id: 'r', status: 'scheduled', team_a_id: 'a', team_b_id: 'b' }],
  };
  const html = renderToStaticMarkup(createElement(OverallPositions, { snapshot, label: id => `Team ${id}` }));
  assert.match(html, /1–2/);
  assert.match(html, /Provisional/);
  assert.match(html, /Only known places are shown/);
  assert.match(html, /Stage standings remain below/);
  snapshot.event!.results_under_review = true;
  assert.equal(renderToStaticMarkup(createElement(OverallPositions, { snapshot, label: id => String(id) })), '');
});

for (const graph of [false, true]) test(`${graph ? 'graph groups' : 'round robin'} keep phase records separate from finalist and champion places`, () => {
  const active = renderStandings(standingsSnapshot(graph, false));
  assert.match(active, /Overall tournament positions/);
  assert.match(active, /1–2/);
  assert.match(active, /Underdog/);
  assert.match(active, /Only known places are shown/);
  if (graph) { assert.match(active, /Group groupA/); assert.match(active, /Group groupB/); }
  else assert.match(active, /Round robin standings/);
  assert.match(active, /6W – 1L/);
  assert.match(active, /2W – 5L/);
  assert.doesNotMatch(active, /🥇|🥈|🥉/, 'Stage rankings must not look like final awards');

  const completed = renderStandings(standingsSnapshot(graph, true));
  const positions = completed.slice(completed.indexOf('Overall tournament positions'), completed.indexOf(graph ? 'Group groupA' : 'Round robin standings'));
  assert.match(positions, /aria-label="Place 1"[^>]*>1<\/span>[\s\S]*?Underdog/);
  assert.match(positions, /aria-label="Place 2"[^>]*>2<\/span>[\s\S]*?Leader/);
  assert.match(completed, /6W – 1L/);
  assert.match(completed, /2W – 5L/);
  assert.doesNotMatch(completed, /🥇|🥈|🥉/, 'Stage rankings must not look like final awards');
});
