import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphReview } from "../../components/tournament-builder/graph-review";
import { TournamentBuilder } from "../../components/tournament-builder/builder";
import { matchTitle, unresolvedSideLabel } from "../../components/tournament-builder/match-presentation";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";
import type { DefinitionPreview } from "../../lib/tournament-builder/preview";

const seed = (seed: number) => ({ kind: "seed", seed });
const rank = (node_id: string, rank: number) => ({ kind: "rank", node_id, rank });
const definition = { ...JSON.parse(readFileSync("tests/tournament-builder/fixtures/tournament-definition.json", "utf8")), schema_version: "2.0", nodes: [
  { id: "reg", module: "registration@1" }, { id: "entries", module: "entries@1", from: "reg" },
  { id: "A", module: "round_robin@2", inputs: [seed(1), seed(4)] },
  { id: "B", module: "round_robin@2", inputs: [seed(2), seed(3)] },
  { id: "SF1", module: "match@1", inputs: [rank("A", 1), rank("B", 2)] },
  { id: "SF2", module: "match@1", inputs: [rank("B", 1), rank("A", 2)] },
  { id: "F", module: "match@1", inputs: [{ kind: "winner", node_id: "SF1" }, { kind: "winner", node_id: "SF2" }] },
  { id: "B3", module: "match@1", inputs: [{ kind: "loser", node_id: "SF1" }, { kind: "loser", node_id: "SF2" }] },
  { id: "places", module: "placements@2", final: "F", bronze: "B3" },
] };
function snapshot(): CommandSnapshot {
  return { event: { id: "event", created_by: "owner", modular_state: "active", revision: 4, definition_id: "def" }, definitions: [{ id: "def", definition }], teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], team_members: [], tournament_players: [], rounds: [{ id: "round", round_type: "elimination", round_number: 1 }], matches: [{ id: "semi", stage_id: "stage-sf", round_id: "round", logical_key: "SF1:m1", status: "scheduled" }], standings: [{ id: "ra", stage_id: "stage-a", team_id: "a", rank: 1 }, { id: "rb", stage_id: "stage-b", team_id: "b", rank: 1 }], stages: [
    { id: "stage-a", node_id: "A", module_id: "round_robin", module_version: 2, state: "blocked", output: { rows: [], ties: [["a", "b"]], inputRevision: 3 } },
    { id: "stage-b", node_id: "B", module_id: "round_robin", module_version: 2, state: "completed" },
    { id: "stage-sf", node_id: "SF1", module_id: "match", module_version: 1, state: "blocked" },
  ] };
}
const preview = { valid: true, errors: [], missing_fields: [], warnings: [], revision: 4, maximumMatches: 6, estimatedMinutes: 65 } as DefinitionPreview;

test("closed registration shows explicit group assignment and pending knockout review before generation", () => {
  const data = snapshot();
  data.event!.modular_state = "registration_closed";
  data.teams.forEach(team => { team.entry_state = "approved"; });
  const html = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: "owner", initialSnapshot: data, initialPreview: { ...preview, generationReady: false }, view: "admin" }));
  assert.match(html, /Assign actual teams to groups/);
  assert.match(html, /Complete pending tournament connections/);
  assert.match(html, /Group for Alpha/);
  assert.match(html, /Group for Beta/);
  assert.match(html, /<option value="A">/);
  assert.match(html, /<option value="B">/);
});

test("match labels use the completed locked graph while preserving the original published plan", () => {
  const data = snapshot();
  data.definitions = [{ id: "def", definition: { ...definition, nodes: definition.nodes.filter((n: { module: string }) => ["registration@1", "entries@1", "round_robin@2"].includes(n.module)) } }];
  data.stages.push({ id: "locked", node_id: "entries", module_id: "entries", output: { finalizedNodes: definition.nodes } });
  const final = { id: "new-final", logical_key: "F:match", round_id: "round" };
  assert.equal(matchTitle(final, data), "Final · F");
  assert.equal(unresolvedSideLabel(final, "a", data), "Winner of SF1");
});
test("block review exposes group, rank, winner and loser routing with node identities", () => {
  const html = renderToStaticMarkup(createElement(GraphReview, { definition }));
  for (const label of ["Group A", "Group B", "Group A rank 1", "Group B rank 2", "Winner of SF1", "Loser of SF2", "Team 4", "Final: F", "Bronze: B3"]) assert.ok(html.includes(label), label);
});
test("match titles and unresolved sides use the actual graph inputs", () => {
  const data = snapshot(), match = data.matches[0];
  assert.equal(matchTitle(match, data), "Match SF1");
  assert.equal(unresolvedSideLabel(match, "a", data), "Group A rank 1");
  assert.equal(unresolvedSideLabel(match, "b", data), "Group B rank 2");
  const final = { ...match, id: "final", stage_id: "stage-final", logical_key: "F:m1" };
  assert.equal(matchTitle(final, data), "Final · F");
  assert.equal(unresolvedSideLabel(final, "a", data), "Winner of SF1");
  const bronze = { ...final, id: "bronze", logical_key: "B3:m1" };
  assert.equal(matchTitle(bronze, data), "Third-place match · B3");
  assert.equal(unresolvedSideLabel(bronze, "b", data), "Loser of SF2");
});
test("later round-robin match sides describe their exact incoming group ranks", () => {
  const data = snapshot();
  const nextDefinition = { ...definition, nodes: [...definition.nodes, { id: "C", module: "round_robin@2", inputs: [rank("A", 1), rank("B", 1), rank("A", 2)] }] };
  data.definitions = [{ id: "def", definition: nextDefinition }];
  const match = { id: "next", logical_key: "C:r2:m1", round_id: "round" };
  data.rounds[0].round_number = 40;
  assert.equal(matchTitle(match, data), "Group C · Round 2");
  assert.equal(unresolvedSideLabel(match, "a", data), "Group A rank 1");
  assert.equal(unresolvedSideLabel(match, "b", data), "Group A rank 2");
});
test("standings remain separate by group and RR2 unresolved ties have administrator draw controls", () => {
  const html = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: "owner", initialSnapshot: snapshot(), initialPreview: preview, view: "standings" }));
  assert.match(html, /Group A/); assert.match(html, /Group B/);
  assert.equal((html.match(/<table/g) ?? []).length, 2);
  const tables = [...html.matchAll(/<h3[^>]*>(Group [AB])<\/h3>(<table[\s\S]*?<\/table>)/g)];
  assert.equal(tables.length, 2);
  assert.match(tables[0][2], /Alpha/); assert.doesNotMatch(tables[0][2], /Beta/);
  assert.match(tables[1][2], /Beta/); assert.doesNotMatch(tables[1][2], /Alpha/);
  assert.match(html, /Resolve remaining ties.*Group A/);
  assert.match(html, /Record a fair draw/);
});
test("overview identifies progress nodes and compares duration to the event window", () => {
  const html = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: "owner", initialSnapshot: snapshot(), initialPreview: preview, view: "overview" }));
  assert.match(html, /Match SF1/); assert.match(html, /Estimated duration: 65 min/); assert.match(html, /Event window:/);
});
test("graph match cards follow scheduling waves while group rounds keep their local numbers", () => {
  const data = snapshot();
  data.rounds = [{ id: "ra", round_number: 1, logical_wave: 2 }, { id: "rb", round_number: 4, logical_wave: 1 }];
  data.matches = [{ id: "a2", stage_id: "stage-a", logical_key: "A:r2:m1", round_id: "ra", status: "scheduled" }, { id: "b1", stage_id: "stage-b", logical_key: "B:r1:m1", round_id: "rb", status: "scheduled" }];
  const html = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: "owner", initialSnapshot: data, initialPreview: preview, view: "matches" }));
  assert.ok(html.indexOf("Group B · Round 1") < html.indexOf("Group A · Round 2"));
  assert.doesNotMatch(html, /Group B · Round 4/);
});
