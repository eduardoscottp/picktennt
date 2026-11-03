import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyDraftPolicyChoice, DraftPolicyEditor, rankingChoices } from "../../components/tournament-builder/draft-policy-editor";
import { TournamentBuilder } from "../../components/tournament-builder/builder";
import { previewDefinition } from "../../lib/tournament-builder/preview";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";

test("owner policy choices repair a partial raw draft without changing other facts", () => {
  const original = { event: { name: "Existing AI draft", venue_name: "My venue" }, nodes: [{ id: "registration" }],
    policies: { match: { target: 15 }, withdrawal: "stage_sensitive_v1", ranking: { custom_note: "keep" } } };
  const ranked = applyDraftPolicyChoice(original, { kind: "ranking", order: ["wins_desc", "points_for_in_losses_desc", "differential_desc"] });
  const confirmed = applyDraftPolicyChoice(ranked, { kind: "confirmation" });
  const corrected = applyDraftPolicyChoice(confirmed, { kind: "correction" });
  assert.deepEqual(corrected, { ...original, policies: { ...original.policies,
    ranking: { custom_note: "keep", version: 1, order: ["wins_desc", "points_for_in_losses_desc", "differential_desc"], final_tie: "recorded_draw" },
    confirmation: "opponent_or_admin_v1", correction: "impact_review_void_and_replay_v1" } });
  assert.equal(corrected.event, original.event);
  assert.equal(corrected.nodes, original.nodes);
  assert.equal("confirmation" in original.policies, false);
  const confirmationOnly = applyDraftPolicyChoice(original, { kind: "confirmation" });
  assert.deepEqual(confirmationOnly, { ...original, policies: { ...original.policies, confirmation: "opponent_or_admin_v1" } });
});

test("partial draft renders explicit choices with supported ranking criteria and fixed-policy explanations", () => {
  const partial = { event: { name: "Incomplete draft" }, policies: {} };
  let changes = 0;
  const html = renderToStaticMarkup(createElement(DraftPolicyEditor, { definition: partial, disabled: false, onChange: () => { changes++; } }));
  assert.equal(changes, 0);
  assert.deepEqual(partial.policies, {});
  assert.match(html, /Start ranking with wins/);
  assert.match(html, /Choose a confirmation policy/);
  assert.match(html, /Choose a correction policy/);
  assert.match(html, /opponent confirms/i);
  assert.match(html, /void and replay/i);
  assert.deepEqual(rankingChoices.map((choice) => choice.key), ["wins_desc", "differential_desc", "points_for_desc", "points_against_asc", "points_for_in_losses_desc"]);
});

test("existing ranking keeps its exact order and excludes duplicate add choices", () => {
  const definition = applyDraftPolicyChoice({}, { kind: "ranking", order: ["wins_desc", "points_against_asc", "points_for_desc"] });
  const html = renderToStaticMarkup(createElement(DraftPolicyEditor, { definition, disabled: true, onChange: () => {} }));
  assert.ok(html.indexOf("Fewest points conceded") < html.indexOf("Points scored"));
  assert.doesNotMatch(html, /option value="wins_desc"/);
  assert.doesNotMatch(html, /option value="points_against_asc"/);
  assert.match(html, /fieldset disabled=""/);
});

test("review page shows owner controls from raw partial snapshot without a validated preview definition", () => {
  const partial = { event: { name: "Raw partial draft" }, policies: { match: { target: 15 } } };
  const initialPreview = previewDefinition(partial, 3);
  assert.equal(initialPreview.definition, undefined);
  const initialSnapshot: CommandSnapshot = { event: { id: "draft", created_by: "owner", modular_state: "draft", revision: 3, definition_id: "definition" },
    definitions: [{ id: "definition", definition: partial }], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  const render = (actorId: string) => renderToStaticMarkup(createElement(TournamentBuilder, { actorId, initialSnapshot, initialPreview }));
  const html = render("owner");
  assert.match(html, /Raw partial draft/);
  assert.match(html, /Start ranking with wins/);
  assert.match(html, /Choose a confirmation policy/);
  assert.match(html, /Choose a correction policy/);
  assert.match(html, /Save changes and refresh review/);
  assert.doesNotMatch(render("viewer"), /Ranking and result policies/);
});
