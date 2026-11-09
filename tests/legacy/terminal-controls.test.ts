import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastProvider } from '../../components/ui/toast';
import { AdminGenerateRound } from '../../components/tournament/admin-generate-round';
import { AdminStatusActions } from '../../components/tournament/admin-status-actions';
import { isLegacyMatchComplete } from '../../lib/tournament/match-result';
import type { Tournament, Match } from '../../types/database';
const tournament: Tournament = { id: 'event', name: 'Legacy test', created_by: 'admin', type: 'doubles', max_players: 8, court_count: 2, status: 'active', games_per_player: null, second_round_format: 'none', advancement_count: null, finals_format: 'top2', finals_trigger: 'after_round_robin', join_code: 'TEST', rules_text: null, is_public: true, is_open: true, tournament_date: null, court_name: null, court_address: null, created_at: '', updated_at: '' };
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test' };
function render(child: ReactElement) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, child)));
}
function schedule(status: Match['status']) {
  const rrMatches = [{ status: 'validated' }, { status }] as Match[];
  return render(createElement(AdminGenerateRound, {
    tournament, playerCount: 8, teamsData: ['a','b','c','d'].map(id => ({id,memberCount:2})),
    currentUserId: 'admin', isCurrentUserPlayer: false, hasExistingRounds: true, rrMatches,
    rrAllValidated: rrMatches.every(isLegacyMatchComplete), hasBracketAlready: false, advancingCount: null,
  }));
}

test('walkover-complete RR exposes finals, while a provisional retirement still blocks', () => {
  assert.match(schedule('walkover'), /Final Only \(Top 2\)/);
  const provisional = schedule('score_entered');
  assert.doesNotMatch(provisional, /Final Only \(Top 2\)/);
  assert.match(provisional, /1 match still needs results/);
});

test('completion control accepts resolved terminal matches but explains unresolved bracket gate', () => {
  const finalTournament = { ...tournament, status: 'finals' as const };
  assert.match(render(createElement(AdminStatusActions, { tournament: finalTournament, allMatchesValidated: true })), /Complete Tournament/);
  assert.match(render(createElement(AdminStatusActions, { tournament: finalTournament, allMatchesValidated: false })), /Resolve all matches and bracket winners/);
});
