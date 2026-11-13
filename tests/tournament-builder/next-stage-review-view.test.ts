import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { NoEligibleChampionNotice, ReviewedGraphFixtures, ReviewedV1Fixtures } from '../../components/tournament-builder/next-stage-review';

const label = (id: unknown) => ({ a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Withdrawn' } as Record<string, string>)[String(id)] ?? 'Unknown';
test('review explicitly warns when no eligible champion can be determined', () => {
  assert.match(renderToStaticMarkup(createElement(NoEligibleChampionNotice, { visible: true })), /No eligible champion will be determined\. Final placements will remain blocked for review\./);
  assert.equal(renderToStaticMarkup(createElement(NoEligibleChampionNotice, { visible: false })), '');
});
type ReviewedFixtures = Parameters<typeof ReviewedV1Fixtures>[0]['fixtures'];
function fixtures(): ReviewedFixtures {
  return [
    { id: 's1', stageId: 'playoff', round: 1, wave: 1, court: 1, a: { kind: 'entry', entryId: 'a' }, b: { kind: 'entry', entryId: 'd' }, resolved_entry_a: 'a', resolved_entry_b: null, automatic_outcome: 'walkover', automatic_winner_entry_id: 'a' },
    { id: 's2', stageId: 'playoff', round: 1, wave: 1, court: 2, a: { kind: 'entry', entryId: 'b' }, b: { kind: 'entry', entryId: 'c' }, resolved_entry_a: 'b', resolved_entry_b: 'c', automatic_outcome: null },
    { id: 'final', stageId: 'playoff', round: 2, wave: 2, court: 1, a: { kind: 'winner', fixtureId: 's1' }, b: { kind: 'winner', fixtureId: 's2' }, resolved_entry_a: 'a', resolved_entry_b: null, automatic_outcome: null },
    { id: 'bronze', stageId: 'playoff', round: 2, wave: 2, court: 2, a: { kind: 'loser', fixtureId: 's1' }, b: { kind: 'loser', fixtureId: 's2' }, bronze: true, resolved_entry_a: null, resolved_entry_b: null, automatic_outcome: null },
  ];
}

test('review renders the vacant slot, automatic walkover and actual final and bronze sources', () => {
  const html = renderToStaticMarkup(createElement(ReviewedV1Fixtures, { fixtures: fixtures(), label }));
  assert.match(html, /Semifinal 1:<\/strong> Alpha vs Vacant · Walkover: Alpha advances automatically/);
  assert.match(html, /Final:<\/strong> Alpha vs Winner of Semifinal 2/);
  assert.match(html, /Third place:<\/strong> Vacant vs Loser of Semifinal 2/);
  assert.doesNotMatch(html, /Withdrawn|Unknown/);
});

test('no-contest feeders show vacant slots and never name a fabricated winner', () => {
  const reviewed = fixtures();
  Object.assign(reviewed[0], { resolved_entry_a: null, resolved_entry_b: null, automatic_outcome: 'no_contest', automatic_winner_entry_id: null });
  Object.assign(reviewed[2], { resolved_entry_a: null });
  const html = renderToStaticMarkup(createElement(ReviewedV1Fixtures, { fixtures: reviewed, label }));
  assert.match(html, /Semifinal 1:<\/strong> Vacant vs Vacant · No contest: no entry advances/);
  assert.match(html, /Final:<\/strong> Vacant vs Winner of Semifinal 2/);
  assert.match(html, /Third place:<\/strong> Vacant vs Loser of Semifinal 2/);
  assert.doesNotMatch(html, /Winner of Semifinal 1|Loser of Semifinal 1|Withdrawn|Unknown/);
});

test('a withdrawn direct entrant remains vacant while the other feeder is pending', () => {
  const reviewed = fixtures();
  Object.assign(reviewed[2], { a: { kind: 'entry', entryId: 'd' }, resolved_entry_a: null, resolved_entry_b: null });
  const html = renderToStaticMarkup(createElement(ReviewedV1Fixtures, { fixtures: reviewed, label }));
  assert.match(html, /Final:<\/strong> Vacant vs Winner of Semifinal 2/);
  assert.doesNotMatch(html, /Withdrawn|Unknown/);
});

test('graph review displays automatic walkovers and dependent vacant slots', () => {
  type Fixtures = Parameters<typeof ReviewedGraphFixtures>[0]['fixtures'];
  const reviewed: Fixtures = [
    { id: 's1:match', stage_id: 's1', kind: 'match@1', team_a_id: 'a', team_b_id: null, match_id: null, outcome_kind: 'walkover', winner_team_id: 'a', side_sources: [], sources: [] },
    { id: 's2:match', stage_id: 's2', kind: 'match@1', team_a_id: 'b', team_b_id: 'c', match_id: null, side_sources: [{ kind: 'entry', entryId: 'b' }, { kind: 'entry', entryId: 'c' }], sources: [] },
    { id: 'f:match', stage_id: 'f', kind: 'final', team_a_id: 'a', team_b_id: null, match_id: null, side_sources: [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }], sources: [] },
    { id: 'br:match', stage_id: 'br', kind: 'bronze', team_a_id: null, team_b_id: null, match_id: null, side_sources: [{ kind: 'loser', node_id: 's1' }, { kind: 'loser', node_id: 's2' }], sources: [] },
  ];
  const html = renderToStaticMarkup(createElement(ReviewedGraphFixtures, { fixtures: reviewed, label, definition: { nodes: [] } }));
  assert.match(html, /s1:<\/strong> Alpha vs Vacant · Walkover: Alpha advances automatically/);
  assert.match(html, /Final:<\/strong> Alpha vs Winner of s2/);
  assert.match(html, /Third place:<\/strong> Vacant vs Loser of s2/);
  assert.doesNotMatch(html, /Withdrawn|Unknown/);
});

test('graph no-contests do not create a winner or loser in the remaining routes', () => {
  type Fixtures = Parameters<typeof ReviewedGraphFixtures>[0]['fixtures'];
  const reviewed: Fixtures = [
    { id: 's1:match', stage_id: 's1', kind: 'match@1', team_a_id: null, team_b_id: null, match_id: null, outcome_kind: 'no_contest', winner_team_id: null, side_sources: [], sources: [] },
    { id: 'f:match', stage_id: 'f', kind: 'final', team_a_id: null, team_b_id: 'a', match_id: null, side_sources: [{ kind: 'winner', node_id: 's1' }, { kind: 'seed', seed: 1 }], sources: [] },
    { id: 'br:match', stage_id: 'br', kind: 'bronze', team_a_id: null, team_b_id: null, match_id: null, side_sources: [{ kind: 'loser', node_id: 's1' }, { kind: 'winner', node_id: 's2' }], sources: [] },
  ];
  const html = renderToStaticMarkup(createElement(ReviewedGraphFixtures, { fixtures: reviewed, label, definition: { nodes: [] } }));
  assert.match(html, /s1:<\/strong> Vacant vs Vacant · No contest: no entry advances/);
  assert.match(html, /Final:<\/strong> Vacant vs Alpha/);
  assert.match(html, /Third place:<\/strong> Vacant vs Winner of s2/);
  assert.doesNotMatch(html, /Winner of s1|Loser of s1|Unknown/);
});

test('existing accepted automatic results leave their dependent slots vacant', () => {
  type Fixtures = Parameters<typeof ReviewedGraphFixtures>[0]['fixtures'];
  const reviewed: Fixtures = [
    { id: 's1:match', stage_id: 's1', kind: 'match@1', team_a_id: null, team_b_id: null, match_id: 'saved-s1', outcome_kind: 'no_contest', winner_team_id: null, side_sources: [], sources: [] },
    { id: 's2:match', stage_id: 's2', kind: 'match@1', team_a_id: 'a', team_b_id: null, match_id: 'saved-s2', outcome_kind: 'walkover', winner_team_id: 'a', side_sources: [], sources: [] },
    { id: 'f:match', stage_id: 'f', kind: 'final', team_a_id: null, team_b_id: 'a', match_id: 'saved-f', side_sources: [{ kind: 'winner', node_id: 's1' }, { kind: 'winner', node_id: 's2' }], sources: [] },
    { id: 'br:match', stage_id: 'br', kind: 'bronze', team_a_id: null, team_b_id: null, match_id: 'saved-br', side_sources: [{ kind: 'loser', node_id: 's1' }, { kind: 'loser', node_id: 's2' }], sources: [] },
  ];
  const html = renderToStaticMarkup(createElement(ReviewedGraphFixtures, { fixtures: reviewed, label, definition: { nodes: [] } }));
  assert.match(html, /Final:<\/strong> Vacant vs Alpha/);
  assert.match(html, /Third place:<\/strong> Vacant vs Vacant/);
  assert.doesNotMatch(html, /Winner of s1|Loser of s1|Loser of s2|Unknown/);
});

test('graph review displays a withdrawn historical winner as a vacant automatic slot', () => {
  type Fixtures = Parameters<typeof ReviewedGraphFixtures>[0]['fixtures'];
  const reviewed: Fixtures = [
    { id: 'f:match', stage_id: 'f', kind: 'final', team_a_id: 'd', team_b_id: 'a', side_a_eligible: false, side_b_eligible: true, match_id: null, outcome_kind: 'walkover', winner_team_id: 'a', side_sources: [], sources: [] },
  ];
  const html = renderToStaticMarkup(createElement(ReviewedGraphFixtures, { fixtures: reviewed, label, definition: { nodes: [] } }));
  assert.match(html, /Final:<\/strong> Vacant vs Alpha · Walkover: Alpha advances automatically/);
  assert.doesNotMatch(html, /Withdrawn|Unknown/);
});
