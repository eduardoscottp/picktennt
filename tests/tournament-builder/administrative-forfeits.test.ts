import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdministrativeForfeits, eligibleForfeitMatches, forfeitReviewFingerprint } from "../../components/tournament-builder/administrative-forfeits";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";

test("forfeit selection includes only current unstarted matches without scores or outcomes", () => {
  const base = { id: "pending", team_a_id: "a", team_b_id: "b", status: "scheduled" };
  const matches = [base, { ...base, id: "started", started_at: "2026-01-01" }, { ...base, id: "scored", score_a: 0 }, { ...base, id: "outcome", outcome_kind: "walkover" }, { ...base, id: "old", is_current: false }, { ...base, id: "other", team_a_id: "c" }, { ...base, id: "unknown", team_b_id: null }];
  assert.deepEqual(eligibleForfeitMatches(matches, "a").map(match => match.id), ["pending"]);
});

test("changing the tournament revision or any forfeit proposal field invalidates the review", () => {
  const proposal = { entry_id: "a", match_ids: ["m"], mode: "walkover", reason: "absent", overwrite_existing: false, regenerate_downstream: false };
  const original = forfeitReviewFingerprint(1, proposal);
  assert.notEqual(forfeitReviewFingerprint(2, proposal), original);
  for (const change of [{ entry_id: "b" }, { match_ids: ["n"] }, { mode: "score" }, { reason: "different" }, { overwrite_existing: true }, { regenerate_downstream: true }]) assert.notEqual(forfeitReviewFingerprint(1, { ...proposal, ...change }), original);
});

test("administrative forfeits require a review and distinguish withdrawing the team", () => {
  const snapshot: CommandSnapshot = { event: { id: "event", revision: 2 }, teams: [{ id: "a", name: "Team A", entry_state: "approved" }], matches: [], definitions: [], team_members: [], tournament_players: [], stages: [], rounds: [], standings: [] };
  const html = renderToStaticMarkup(createElement(AdministrativeForfeits, { snapshot, disabled: false, label: id => String(id), matchLabel: id => id, run: async () => {} }));
  assert.match(html, /walkovers \/ forfeits/);
  assert.match(html, /team remains in the tournament/);
  assert.match(html, /For a game already in progress/);
  assert.match(html, /choose Retirement and the winner/);
  assert.match(html, /Review forfeits and consequences/);
  assert.doesNotMatch(html, /Confirm reviewed forfeits/);
});
