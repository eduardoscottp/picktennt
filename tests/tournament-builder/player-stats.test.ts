import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerStats } from "../../components/tournament-builder/player-stats";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";

function fixture(): CommandSnapshot {
  return { event: { id: "event", modular_state: "active" }, definitions: [],
    teams: [{ id: "a", name: "Team A" }, { id: "b", name: "Team B" }],
    tournament_players: [{ id: "p", user_id: "player", display_name: "Player One", status: "approved" }],
    team_members: [{ id: "m", user_id: "player", team_id: "a", membership_status: "active" }, { id: "opponent", team_id: "b", user_id: "other", display_name: "Opponent Name", membership_status: "active" }],
    standings: [{ id: "rank", team_id: "a", stage_id: "group", rank: 2, wins: 3, losses: 1, eligible: true }],
    stages: [{ id: "group", node_id: "Group A" }], rounds: [{ id: "r", round_number: 4 }],
    matches: [{ id: "upcoming", team_a_id: "a", team_b_id: "b", round_id: "r", court_number: 2, status: "scheduled" }, { id: "old", team_a_id: "a", team_b_id: "b", status: "scheduled", is_current: false }], };
}
const render = (snapshot: CommandSnapshot) => renderToStaticMarkup(createElement(PlayerStats, { snapshot, doubles: true }));

test("player statistics reflect the eligible stage and current assigned match", () => {
  const html = render(fixture());
  for (const value of ["Player One", "#2", "3-1", "Group A", "R4", "Opponent Name", "Court 2", "Team W/L"]) assert.ok(html.includes(value), value);
  assert.match(html, /Remaining<\/p><p[^>]*>1<\/p>/);
});

test("missing or ambiguous data never fabricates an overall rank or next match", () => {
  const data = fixture();
  data.standings.push({ id: "other-rank", team_id: "a", stage_id: "other", rank: 1, wins: 4, losses: 0 });
  data.matches.push({ id: "unordered", team_a_id: "a", team_b_id: "b", status: "scheduled" });
  const html = render(data);
  assert.match(html, /Rankings vary by stage/); assert.match(html, /Next match order is not available/);
  assert.doesNotMatch(html, /#1|#2|3-1|Next match: Opponent Name/);
  data.event!.results_under_review = true; data.standings = [data.standings[0]]; data.matches = [];
  const hidden = render(data);
  assert.doesNotMatch(hidden, /#2|3-1/); assert.match(hidden, /No known upcoming match/);
});
