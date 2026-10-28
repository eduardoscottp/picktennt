import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuilderMatch } from "../../components/tournament-builder/match-card";
import { administratorDecisionProblem, matchEditorKey, matchTitle, unresolvedSideLabel } from "../../components/tournament-builder/match-presentation";
import type { StorageRow } from "../../lib/tournament-builder/commands";
const match: StorageRow = { id: "m1", status: "score_entered", team_a_id: "a", team_b_id: "b", started_at: "2026-10-28T12:00:00Z", score_a: 11, score_b: 5, result_revision: 4, revision: 4, court_number: 1 };
const props = { match, label: (id: unknown) => String(id), admin: true, disabled: false, run: async () => {}, tournamentId: "event", revision: 4, owner: true, matchLabel: (id: string) => id, courts: 2, scorePolicy: { target: 11, win_by: 2 } };
test("administrator can validate a saved played score without typing a reason", () => {
  const html = renderToStaticMarkup(createElement(BuilderMatch, { ...props, feedback: "The court is occupied. Move to a free court." }));
  assert.match(html, /Validate saved score/);
  assert.match(html, /Validation note \(optional\)/);
  assert.doesNotMatch(html, /Enter a decision reason/);
  const validate = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].find((button) => button[2].includes("Validate saved score"));
  assert.ok(validate);
  assert.doesNotMatch(validate[1], /\sdisabled(?:=|\s|$)/);
  assert.match(html, /role="alert"[^>]*>The court is occupied/);
  assert.doesNotMatch(html, /Attest this result/);
});

test("administrator who is also a player gets one primary save-and-validate action", () => {
  const html = renderToStaticMarkup(createElement(BuilderMatch, { ...props, ownEntry: "a", match: { ...match, status: "in_progress" } }));
  assert.match(html, /Save &amp; Validate/);
  assert.doesNotMatch(html, /Submit provisional score/);
  const disputed = renderToStaticMarkup(createElement(BuilderMatch, { ...props, match: { ...match, status: "disputed" } }));
  assert.match(disputed, /Decision reason \(required to validate\)/);
  assert.match(disputed, /Enter a decision reason/);
});
test("disabled decisions explain physical start, legal scores, reason and outcome constraints", () => {
  const valid = { kind: "played", started: true, scoreA: "11", scoreB: "5", winner: "", reason: "Observed final score", policy: { target: 11, win_by: 2 } };
  assert.equal(administratorDecisionProblem(valid), "");
  assert.equal(administratorDecisionProblem({ ...valid, started: false }), "");
  assert.match(administratorDecisionProblem({ ...valid, scoreA: "10", scoreB: "9" }), /completed score to 11/);
  assert.match(administratorDecisionProblem({ ...valid, reason: " " }), /decision reason/);
  assert.match(administratorDecisionProblem({ ...valid, kind: "walkover", winner: "a" }), /retirement instead/);
  assert.equal(administratorDecisionProblem({ ...valid, kind: "retirement", started: false, winner: "a" }), "");
});
test("rest controls are absent and all match input IDs remain unique", () => {
  const scheduled = { ...match, status: "scheduled", started_at: null, score_a: null, score_b: null };
  const html = renderToStaticMarkup(createElement(Fragment, null, createElement(BuilderMatch, { ...props, match: scheduled }), createElement(BuilderMatch, { ...props, match: { ...scheduled, id: "m2" } })));
  assert.doesNotMatch(html, /override minimum rest|Start with rest override/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((result) => result[1]);
  assert.equal(ids.length, new Set(ids).size);
  const player = renderToStaticMarkup(createElement(BuilderMatch, { ...props, match: scheduled, admin: false, owner: false, ownEntry: "a" }));
  assert.doesNotMatch(player, /override minimum rest|Start with rest override|Save &amp; Validate/);
});
test("playoff cards name semifinals, final and bronze and explain unresolved feeders", () => {
  const first = { id: "s1", round_id: "r1", logical_key: "playoff:r1:m1", bracket_next_winner_match_id: "final", bracket_winner_fills_side: "a", bracket_next_loser_match_id: "bronze", bracket_loser_fills_side: "a" };
  const second = { ...first, id: "s2", round_id: "r2", logical_key: "playoff:r1:m2", bracket_winner_fills_side: "b", bracket_loser_fills_side: "b" };
  const final = { id: "final", round_id: "rf", status: "scheduled" };
  const bronze = { id: "bronze", round_id: "rb", status: "scheduled" };
  const schedule = { matches: [first, second, final, bronze], rounds: [{ id: "r1", round_type: "elimination" }, { id: "r2", round_type: "elimination" }, { id: "rf", round_type: "finals_gold" }, { id: "rb", round_type: "finals_bronze" }] };
  assert.equal(matchTitle(first, schedule), "Semifinal 1");
  assert.equal(matchTitle(second, schedule), "Semifinal 2");
  assert.equal(matchTitle(final, schedule), "Final");
  assert.equal(matchTitle(bronze, schedule), "Third-place match");
  assert.equal(unresolvedSideLabel(final, "a", schedule), "Winner of Semifinal 1");
  assert.equal(unresolvedSideLabel(bronze, "b", schedule), "Loser of Semifinal 2");
  const html = renderToStaticMarkup(createElement(BuilderMatch, { ...props, match: final, title: "Final", unresolvedA: unresolvedSideLabel(final, "a", schedule), unresolvedB: unresolvedSideLabel(final, "b", schedule) }));
  assert.match(html, /Validate both semifinals/);
  assert.match(html, /Winner of Semifinal 1/);
  assert.doesNotMatch(html, /Save &amp; Validate|Start match<\/button>/);
});
test("match form remounts for changed stored scores or court, but not unrelated event revisions", () => {
  assert.equal(matchEditorKey(match), matchEditorKey({ ...match }));
  assert.notEqual(matchEditorKey(match), matchEditorKey({ ...match, score_a: 12, score_b: 10 }));
  assert.notEqual(matchEditorKey(match), matchEditorKey({ ...match, court_number: 2 }));
  assert.notEqual(matchEditorKey(match), matchEditorKey({ ...match, revision: 5 }));
});
