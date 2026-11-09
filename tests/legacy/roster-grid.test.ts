import assert from 'node:assert/strict';
import test, { before, mock } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastProvider } from '../../components/ui/toast';
const noop = async () => {};
mock.module('../../lib/tournament/player-removal.ts', { namedExports: { removePlayerSimple: noop, deleteAllRoundsAndRemovePlayer: noop, forfeitLegacyTeam: noop } });
mock.module('../../lib/tournament/player-replacement.ts', { namedExports: { assignLegacyPlayer: noop, replaceLegacyPlayer: noop } });
let Grid: typeof import('../../components/tournament/doubles-team-grid')['DoublesTeamGrid'];
before(async () => { Grid = (await import('../../components/tournament/doubles-team-grid')).DoublesTeamGrid; });
const member = { user_id: 'old', first_name: 'Ana', last_name: 'Player', avatar_url: null, tournament_player_id: 'tp', removal_path: 'A' as const, games_played: 0, in_progress_match_id: null };
const teams = Array.from({ length: 4 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i + 1}`, members: i === 0 ? [member] : [] }));
function render(admin = false, approved = true, readonly = false, assigned = false, allowRemoval = true) {
 const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test' };
 return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, createElement(Grid, { tournamentId: 'event', teams, isAdmin: admin, currentUserId: 'player', myTeamId: assigned ? 'team-0' : null, isApprovedPlayer: approved, existingMemberIds: ['old'], readonly, allowRemoval }))));
}
test('restored legacy roster shows all seven available spots to an approved unassigned player', () => {
 assert.equal((render().match(/Join this spot/g) ?? []).length, 7);
 assert.doesNotMatch(render(false, true, false, true), /Join this spot/);
 assert.doesNotMatch(render(false, false, true), /Join this spot|title="Replace|title="Remove/);
});
test('legacy administrator retains add, removal and explicit replacement controls', () => {
 const html = render(true);
 assert.equal((html.match(/Add player/g) ?? []).length, 7);
 assert.match(html, /title="Replace Ana"/);
 assert.match(html, /title="Remove Ana Player"/);
});

test('started legacy roster removes individual removal without hiding existing replacement management', () => {
 const html = render(true, true, false, false, false);
 assert.doesNotMatch(html, /title="Remove/);
 assert.match(html, /title="Replace Ana"/);
 assert.doesNotMatch(html, /Retirement|Walkover/);
});
