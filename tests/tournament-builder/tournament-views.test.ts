import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentBuilder, type TournamentBuilderView } from "../../components/tournament-builder/builder";
import { RegisteredEntryForm, registeredEntryData } from "../../components/tournament-builder/registered-entry";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";
import { previewDefinition } from "../../lib/tournament-builder/preview";
import { ToastProvider } from "../../components/ui/toast";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { orderedMatches, reachedStage } from "../../components/tournament-builder/match-presentation";

const definition = JSON.parse(readFileSync("tests/tournament-builder/fixtures/tournament-definition.json", "utf8"));
function snapshot(state = "active", caller_role = "owner"): CommandSnapshot & { caller_role: string } {
  return { caller_role, event: { id: "event", created_by: "owner", modular_state: state, revision: 4, definition_id: "definition", roster_revision: 3 },
    definitions: [{ id: "definition", definition }], teams: [{ id: "a", name: "Alpha", entry_state: "approved" }, { id: "b", name: "Beta", entry_state: "approved" }, { id: "c", name: "Pending entry", entry_state: "pending" }],
    team_members: [{ id: "ma", team_id: "a", user_id: "player", membership_status: "active", consented_at: "2026-10-28" }, { id: "mb", team_id: "b", user_id: "opponent", membership_status: "active", consented_at: "2026-10-28" }], tournament_players: [],
    rounds: [{ id: "round", round_type: "round_robin", round_number: 1 }], matches: [{ id: "match", round_id: "round", status: "score_entered", team_a_id: "a", team_b_id: "b", started_at: "2026-10-28", score_a: 11, score_b: 5, submitted_entry_id: "b", result_revision: 4, court_number: 1 }],
    standings: [{ id: "standing", team_id: "a", rank: 1, wins: 2, losses: 0, points_for: 22, points_against: 10, tie_group: "a,b" }],
    stages: [{ id: "rr", module_id: "round_robin", state: "ready" }, { id: "standings", module_id: "standings", state: "blocked", output: { ties: [["a", "b"]], inputRevision: 4 } }, { id: "places", module_id: "placements", state: "completed", output: { groups: [{ rank: 1, entryIds: ["a"] }, { rank: 2, entryIds: ["b", "c"] }] } }] };
}
function render(view: TournamentBuilderView, data = snapshot(), actorId = "owner") {
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: "test" };
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ToastProvider, null, createElement(TournamentBuilder, { actorId, initialSnapshot: data, initialPreview: previewDefinition(definition, 4), view }))));
}
function openRoster(role = "player") {
  const data = snapshot("registration_open", role);
  const openDefinition = structuredClone(definition);
  openDefinition.registration.closes_at = "2099-01-01T00:00:00Z";
  data.definitions = [{ id: "definition", definition: openDefinition }];
  data.matches = [];
  return data;
}
test("match ordering prioritizes the player's matches and sorts each group by round", () => {
  const rounds = [{ id: "r1", round_number: 1 }, { id: "r2", round_number: 2 }];
  const matches = [{ id: "other", round_id: "r1", team_a_id: "c", team_b_id: "d" }, { id: "mine2", round_id: "r2", team_a_id: "a", team_b_id: "c" }, { id: "mine1", round_id: "r1", team_a_id: "b", team_b_id: "a" }, { id: "void", round_id: "r1", team_a_id: "a", voided_at: "now" }];
  assert.deepEqual(orderedMatches(matches, rounds, ["a"], true, false).map(match => match.id), ["mine1", "mine2", "other"]);
  assert.deepEqual(orderedMatches(matches, rounds, ["a"], false, false).map(match => match.id), ["other", "mine1", "mine2"]);
  const graphMatches = [{ id: "r2", round_id: "early", logical_key: "A:r2:m1" }, { id: "r1", round_id: "late", logical_key: "B:r1:m1" }];
  assert.deepEqual(orderedMatches(graphMatches, [{ id: "early", logical_wave: 1 }, { id: "late", logical_wave: 3 }], [], false, true).map(match => match.id), ["r1", "r2"]);
});
test("stage labels follow assigned playoff matches and ignore voided matches", () => {
  const schedule = { rounds: [{ id: "sf", round_type: "elimination", round_number: 1 }, { id: "final", round_type: "finals_gold", round_number: 2 }], matches: [{ id: "sf1", round_id: "sf", team_a_id: "a", team_b_id: "b", bracket_next_winner_match_id: "f" }, { id: "f", round_id: "final", team_a_id: "a", team_b_id: "c" }, { id: "old", round_id: "final", team_a_id: "b", voided_at: "now" }] };
  assert.equal(reachedStage("a", schedule), "Final");
  assert.equal(reachedStage("b", schedule), "Semifinal");
  assert.equal(reachedStage("unknown", schedule), undefined);
});
test("published overview reuses normal navigation and shows rules, progress and roster without match or results walls", () => {
  const html = render("overview");
  assert.match(html, /id="rules"/); assert.match(html, /Progress/); assert.match(html, /id="entries"/);
  assert.doesNotMatch(html, /id="matches"|id="placements"|Save &amp; Validate|Organizer review and event controls/);
  for (const path of ["/tournaments/event", "/tournaments/event/matches", "/tournaments/event/leaderboard", "/tournaments/event/admin"]) assert.ok(html.includes(`href="${path}"`));
  assert.match(html, /View more · Format and rules/);
  assert.match(html, /<details id="rules"/);
  assert.doesNotMatch(html, /<details id="rules"[^>]* open/);
  assert.ok(html.indexOf('Progress') < html.indexOf('id="entries"'));
  assert.match(html, /border-brand-100 shadow-sm/);
  assert.doesNotMatch(html, /Open Matches|Manage tournament/);
  assert.doesNotMatch(html, /href="#matches"|href="#placements"/);
});
test("overview keeps result and format warnings visible while its rules are collapsed", () => {
  const data = snapshot(); data.event!.results_under_review = true;
  const html = render("overview", data);
  assert.ok(html.indexOf('Final placements are temporarily withheld') > html.indexOf('</details>'));
  assert.match(html, /View more · Format and rules/);
});
test("overview keeps individual positions without the registration activity list", () => {
  const data = openRoster();
  data.teams.push({ id: "old-entry", name: "Old registration activity", entry_state: "approved" });
  const html = render("overview", data, "player");
  assert.match(html, /Choose your|Join tournament/);
  assert.doesNotMatch(html, /Old registration activity/);
});
test("matches retains scoring while standings shows rankings and tie controls", () => {
  const matches = render("matches");
  assert.match(matches, /id="matches"/); assert.match(matches, /Validate saved score/); assert.doesNotMatch(matches, /Resolve remaining ties/);
  assert.doesNotMatch(matches, /id="entries"|Edit tournament/);
  assert.doesNotMatch(matches, /id="rules"|id="placements"/);
  const standings = render("standings");
  assert.match(standings, /Leaderboard/); assert.match(standings, /🥇/); assert.match(standings, /2W – 0L · 22:10/); assert.match(standings, /Tied/); assert.doesNotMatch(standings, /id="placements"|Shared placement/); assert.match(standings, /Resolve remaining ties/);
  assert.doesNotMatch(standings, /id="rules"|id="entries"|id="matches"/);
});
test("match cards show round, court and uniformly styled player names", () => {
  const data = snapshot("active", "player");
  data.team_members = [
    { id: "a1", team_id: "a", user_id: "p1", membership_status: "active", display_name: "Player One" },
    { id: "a2", team_id: "a", user_id: "p2", membership_status: "active", display_name: "Player Two" },
    { id: "b1", team_id: "b", user_id: "p3", membership_status: "active", display_name: "Player Three" },
    { id: "b2", team_id: "b", user_id: "p4", membership_status: "active", display_name: "Player Four" },
  ];
  const html = render("matches", data, "p1");
  assert.match(html, /Round 1 - Court 1/);
  for (const name of ["Player One", "Player Two", "Player Three", "Player Four"]) assert.ok(html.includes(`class="text-sm font-bold text-gray-900">${name}</p>`));
});
test("completed match displays historical players rather than the current replacement", () => {
  const data = snapshot("completed");
  data.matches[0] = { ...data.matches[0], status: "validated", outcome_kind: "played", is_current: true, player_a1_id: "former", player_a1_name: "Former Player", player_b1_id: "opponent", player_b1_name: "Opponent" };
  data.team_members[0] = { ...data.team_members[0], user_id: "replacement", display_name: "New Player" };
  const html = render("matches", data);
  assert.match(html, /Former Player/); assert.match(html, /Opponent/); assert.doesNotMatch(html, /New Player/);
  const dupr = render("admin", data);
  assert.match(dupr, /Former Player vs Opponent/);
});
test("standings show player names including entries without results", () => {
  const data = snapshot();
  data.team_members[0].display_name = "Player One";
  assert.match(render("standings", data), /Player One/);
  data.standings = [];
  data.tournament_players = [{ id: "unplaced", user_id: "unplaced", status: "approved", display_name: "Waiting Player" }];
  data.team_members.push({ id: "pending-member", team_id: "c", user_id: "unplaced", membership_status: "active" });
  const empty = render("standings", data);
  assert.match(empty, /Not yet ranked/);
  assert.match(empty, /Player One/);
  assert.match(empty, /Beta/);
  assert.match(empty, /Waiting Player/);
});
test("admin view contains entry and lifecycle controls, links to score administration and excludes match wall", () => {
  const html = render("admin", snapshot("registration_open"));
  assert.match(html, /Tournament administration/); assert.match(html, /Approve entry/); assert.match(html, /Close registration/); assert.match(html, /Withdraw Alpha/); assert.match(html, /Organizer review and event controls/);
  assert.match(html, /<details open=""[^>]*><summary[^>]*>Edit tournament (setup and teams|name and venue)/);
  assert.match(html, /Open Matches to enter, validate, or correct scores/);
  assert.doesNotMatch(html, /id="rules"|id="matches"|id="placements"|Join as a player/);
  const overview = render("overview", snapshot("registration_open"));
  assert.doesNotMatch(overview, /Approve entry|Close registration/);
  assert.match(render("admin", snapshot("active")), /Apply walkovers \/ forfeits to pending matches/);
  assert.match(render("admin", snapshot("active")), /Withdraw a player/);
});
test("member views preserve own consent and opponent confirmation while restricting administrator actions", () => {
  const member = openRoster();
  const overview = render("overview", member, "new-player");
  assert.match(overview, /Join tournament/); assert.match(overview, /I accept the published rules/);
  assert.doesNotMatch(overview, /href="\/tournaments\/event\/admin"|Manage tournament|Approve entry/);
  const active = snapshot("active", "player");
  active.tournament_players = [{ id: "player-row", user_id: "player", status: "approved" }, { id: "third-row", user_id: "third", status: "approved" }];
  const matches = render("matches", active, "player");
  assert.match(matches, /Validate submitted score/); assert.doesNotMatch(matches, /Save &amp; Validate|Record a fair draw/);
  assert.match(render("matches", active, "third"), /Validate submitted score/);
  assert.doesNotMatch(render("matches", active, "visitor"), /Validate submitted score/);
  assert.match(render("standings", active, "player"), /An administrator must record a draw/);
  const denied = render("admin", member, "player");
  assert.match(denied, /Only tournament administrators/); assert.doesNotMatch(denied, /id="entries"|Close registration|Approve entry/);
  assert.doesNotMatch(render("admin", active, "player"), /Apply walkovers \/ forfeits/);
  assert.doesNotMatch(render("admin", active, "player"), /Withdraw a player/);
});
test("player stats are limited to active tournament administrators and approved players", () => {
  const data = snapshot("active", "player");
  data.tournament_players = [{ id: "p", user_id: "player", status: "approved", display_name: "Player One" }];
  assert.match(render("overview", data, "player"), /Player stats/);
  assert.doesNotMatch(render("overview", data, "visitor"), /Player stats/);
  assert.match(render("overview", snapshot("active"), "owner"), /Player stats/);
  data.event!.modular_state = "registration_open";
  assert.doesNotMatch(render("overview", data, "player"), /Player stats/);
});
test("delegated admins retain administration but owner-only event controls remain restricted", () => {
  const html = render("admin", snapshot("registration_open", "admin"), "delegate");
  assert.match(html, /Approve entry|Close registration/);
  assert.doesNotMatch(html, /Organizer review and event controls|Cancel tournament/);
});
test("draft view keeps complete review experience and standings withhold reviewed final placements", () => {
  const draft = render("builder", snapshot("draft"));
  assert.match(draft, /Review the tournament|Ranking and result policies/); assert.match(draft, /Save changes and refresh review/); assert.match(draft, /Approve rules and open registration/);
  assert.match(draft, /id="matches"|id="placements"/);
  const underReview = snapshot(); underReview.event!.results_under_review = true;
  const standings = render("standings", underReview);
  assert.match(standings, /Final placements are temporarily withheld/);
  assert.doesNotMatch(standings, /Shared placement/);
});
test("tournament views do not contain account AI connection settings", () => {
  assert.doesNotMatch(render("builder", snapshot("draft")), /\/oauth\/connections|AI connections/);
  for (const view of ["overview", "matches", "standings", "admin"] as const) assert.doesNotMatch(render(view), /\/oauth\/connections|AI connections/);
});

test("account-free guest enrollment is absent for every view and administrator role", () => {
  for (const [role, actor] of [["owner", "owner"], ["admin", "delegate"], ["player", "player"]]) {
    for (const state of ["draft", "registration_open", "registration_closed", "ready", "active", "completed"]) {
      for (const view of ["builder", "overview", "matches", "standings", "admin"] as const) {
        assert.doesNotMatch(render(view, snapshot(state, role), actor), /Guest player name|Guest partner name|Add guest entry|Register guest players|No email or Picktennt account is needed/);
      }
    }
  }
});

test("historical guest roster remains readable without a fabricated account or acceptance count", () => {
  const data = snapshot("registration_open");
  data.teams = [{ id: "guest-entry", name: "Guest team", entry_state: "approved", guest_definition_id: "definition", guest_players: [{ id: "guest-a", name: "Guest One" }, { id: "guest-b", name: "Guest Two" }] }];
  data.team_members = [];
  const html = render("admin", data);
  assert.match(html, /Guest · administrator registered/); assert.match(html, /Guest One &amp; Guest Two/);
  assert.doesNotMatch(html, /0\/2 accepted|2\/2 accepted/);
});



test("administrator-enrolled real accounts show actual names and never pretend personal acceptance or invitations", () => {
  const data = snapshot("registration_open", "player");
  data.teams = [{ id: "admin-entry", name: "Verified pair", entry_state: "approved", admin_definition_id: "definition", registered_by: "owner" }];
  data.team_members = [{ id: "one", team_id: "admin-entry", user_id: "player", membership_status: "active", admission_source: "administrator", consented_at: null, consented_definition_id: null, display_name: "Real Player One" }, { id: "two", team_id: "admin-entry", user_id: "opponent", membership_status: "active", admission_source: "administrator", consented_at: null, consented_definition_id: null, display_name: "Real Player Two" }];
  const html = render("admin", data, "owner");
  assert.match(html, /Administrator enrolled · Picktennt account/);
  assert.match(html, /Real Player One &amp; Real Player Two/);
  assert.doesNotMatch(html, /0\/2 accepted|2\/2 accepted|Join as a player|Request my entry|Accept invitation/);
});

test("individual roster placement is available to current native administrators while registration is open", () => {
  for (const [role, actor] of [["owner", "owner"], ["admin", "delegate"]]) {
    const html = render("admin", openRoster(role), actor);
    assert.match(html, /find an existing Picktennt account/);
    assert.match(html, /administrator can enroll the player directly/);
    assert.doesNotMatch(html, /Register existing Picktennt players|Player’s Picktennt username|Partner’s Picktennt username|Enroll registered entry/);
    assert.doesNotMatch(html, /No email or Picktennt account is needed/);
  }
  for (const state of ["draft", "registration_closed", "ready", "active", "completed"]) assert.doesNotMatch(render("admin", snapshot(state)), /Enroll registered entry/);
  assert.doesNotMatch(render("admin", snapshot("registration_open", "player"), "player"), /Enroll registered entry/);
  assert.doesNotMatch(render("overview", snapshot("registration_open")), /Enroll registered entry/);
  const closed = openRoster(); closed.event!.modular_state = "registration_closed";
  assert.match(render("admin", closed, "owner"), /Place registered player in team 1 position 1/);
  assert.doesNotMatch(render("overview", { ...closed, caller_role: "player" }, "player"), /Place registered player in team 1 position 1/);
});

test("individual positions remain visible but self-service closes with registration", () => {
  const data = openRoster();
  data.tournament_players = [{ id: "player-row", user_id: "player", status: "approved", display_name: "Player One" }];
  data.teams = [{ id: "slot", name: "Team 1", entry_state: "approved", registration_slot: 1 }];
  data.team_members = [{ id: "member", team_id: "slot", user_id: "player", membership_status: "active", player_slot: 1, display_name: "Player One" }];
  const open = render("overview", data, "player");
  assert.match(open, /Leave tournament/); assert.match(open, /Move here/); assert.match(open, /Player One/);
  assert.match(open, /aria-label="Choose team 1 position 2"/);
  data.event!.modular_state = "registration_closed";
  const closed = render("overview", data, "player");
  assert.match(closed, /contact the administrator/); assert.match(closed, /Player One/);
  assert.doesNotMatch(closed, /Leave tournament|Move here|Cancel my entry|Withdraw Team 1/);
});

test("registered-account form starts disabled and binds only distinct resolved profile IDs, current definition and admin audit reason", () => {
  const definitionId = "00000000-0000-4000-8000-000000000010", first = "00000000-0000-4000-8000-000000000011", second = "00000000-0000-4000-8000-000000000012";
  const props = { definitionId, capacityFull: false, disabled: false, enrolledPlayerIds: [], run: async () => {} };
  const single = renderToStaticMarkup(createElement(RegisteredEntryForm, { ...props, doubles: false }));
  assert.match(single, /Player’s Picktennt username/); assert.doesNotMatch(single, /Partner’s Picktennt username/);
  assert.match(single, /<button[^>]*disabled=""[^>]*>Enroll registered entry/);
  const full = renderToStaticMarkup(createElement(RegisteredEntryForm, { ...props, doubles: true, capacityFull: true }));
  assert.match(full, /All available entries are filled/); assert.match(full, /fieldset disabled=""/);
  assert.doesNotMatch(full, /Choose a different registered account for each player/);
  assert.deepEqual(registeredEntryData(definitionId, [first, second], "  Verified pair  "), { definition_id: definitionId, player_ids: [first, second], entry_name: "Verified pair", reason: "Administrator enrolled existing Picktennt accounts." });
  assert.equal(registeredEntryData(definitionId, [first, first], "Duplicate"), null);
  assert.equal(registeredEntryData(definitionId, [first], " "), null);
  assert.equal(registeredEntryData("", [first], "Name"), null);
});


test("only the current owner sees native administrator access management with real safe names", () => {
  const data = snapshot("active");
  data.admins = [{ id: "owner-admin", user_id: "owner", display_name: "Organizer", succession_order: 1, granted_by: "owner" }, { id: "delegate-admin", user_id: "delegate", display_name: "Helper Account", succession_order: 2, granted_by: "owner" }];
  const html = render("admin", data);
  assert.match(html, /Manage tournament administrators|Organizer|Helper Account|Owner · protected/);
  assert.match(html, /Find a Picktennt player/); assert.match(html, /Reason for administrator change|Review administrator change/);
  assert.match(html, /Choose removal for Helper Account/);
  assert.doesNotMatch(html, /Choose removal for Organizer/);
  assert.doesNotMatch(html, /I reviewed this administrator access change and want to proceed/);
  data.caller_role = "admin";
  const delegate = render("admin", data, "delegate");
  assert.doesNotMatch(delegate, /Manage tournament administrators|Choose removal/);
  assert.doesNotMatch(render("overview", data), /Manage tournament administrators/);
});

test("missing administrator snapshot does not fabricate administrators or enable blind role changes", () => {
  const html = render("admin", snapshot("active"));
  assert.match(html, /Refresh the tournament to load its current administrators/);
  const start = html.indexOf('aria-label="Tournament administrator management"');
  assert.ok(start >= 0);
  assert.doesNotMatch(html.slice(start, html.indexOf('</section>', start)), /Choose removal|Find a Picktennt player/);
});

test("registration Matches shows an empty state without entry management or scoring", () => {
  const data = snapshot("registration_open");
  data.team_members[0].display_name = "Alicia Player";
  const html = render("matches", data);
  assert.match(html, /Matches will appear here after the administrator generates them/);
  assert.doesNotMatch(html, /Alicia Player|Alpha|Pending entry|Approve entry|Edit tournament/);
  assert.doesNotMatch(html, /Validate saved score|Save &amp; Validate|Confirm opponent/);
  const player = render("matches", { ...data, caller_role: "player" }, "player");
  assert.doesNotMatch(player, /Your entry|Alicia Player/);
  assert.doesNotMatch(player, /Register existing Picktennt players|Approve entry|Edit tournament/);
});

test("published Overview and Admin reuse the existing join-code sharing component", () => {
  const data = snapshot("registration_open");
  data.event!.join_code = "PICK1234";
  for (const view of ["overview", "admin"] as const) {
    const html = render(view, data);
    assert.match(html, /PICK1234/);
    assert.match(html, /Share Tournament · Code/);
    assert.match(html, /max-w-2xl|text-brand-600/);
  }
  data.event!.modular_state = "draft";
  assert.doesNotMatch(render("builder", data), /Share Tournament · Code/);
});

test("completed Admin provides explicit DUPR selection and blocks results under review", () => {
  const data = snapshot("completed");
  data.matches[0] = { ...data.matches[0], is_current: true, status: "validated", outcome_kind: "played", submit_to_dupr: false };
  const html = render("admin", data);
  assert.match(html, /DUPR submission|Alpha vs Beta/);
  data.team_members[0].display_name = "Player One";
  data.team_members[1].display_name = "Player Two";
  assert.match(render("admin", data), /Player One vs Player Two/);
  assert.doesNotMatch(render("overview", data), /DUPR submission/);
  data.event!.results_under_review = true;
  assert.match(render("admin", data), /Resolve results under review before selecting or submitting/);
});
