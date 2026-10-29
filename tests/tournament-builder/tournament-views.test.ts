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
  return renderToStaticMarkup(createElement(ToastProvider, null, createElement(TournamentBuilder, { actorId, initialSnapshot: data, initialPreview: previewDefinition(definition, 4), view })));
}
test("published overview reuses normal navigation and shows rules, progress and roster without match or results walls", () => {
  const html = render("overview");
  assert.match(html, /id="rules"/); assert.match(html, /Progress/); assert.match(html, /id="entries"/);
  assert.doesNotMatch(html, /id="matches"|id="placements"|Save &amp; Validate|Organizer review and event controls/);
  for (const path of ["/tournaments/event", "/tournaments/event/matches", "/tournaments/event/leaderboard", "/tournaments/event/admin"]) assert.ok(html.includes(`href="${path}"`));
  assert.match(html, /Open Matches/); assert.match(html, /Manage tournament/);
  assert.doesNotMatch(html, /href="#matches"|href="#placements"/);
});
test("matches view retains scoring and ties while standings view contains rankings and shared placements", () => {
  const matches = render("matches");
  assert.match(matches, /id="matches"/); assert.match(matches, /Validate saved score/); assert.match(matches, /Resolve remaining ties/);
  assert.match(matches, /id="entries"/);
  assert.doesNotMatch(matches, /id="rules"|id="placements"/);
  const standings = render("standings");
  assert.match(standings, /<table/); assert.match(standings, /id="placements"/); assert.match(standings, /Shared placement/); assert.match(standings, /Resolve remaining ties/);
  assert.doesNotMatch(standings, /id="rules"|id="entries"|id="matches"/);
});
test("admin view contains entry and lifecycle controls, links to score administration and excludes match wall", () => {
  const html = render("admin", snapshot("registration_open"));
  assert.match(html, /Tournament administration/); assert.match(html, /Approve entry/); assert.match(html, /Close registration/); assert.match(html, /Withdraw Alpha/); assert.match(html, /Organizer review and event controls/);
  assert.match(html, /Open Matches to enter, validate, or correct scores/);
  assert.doesNotMatch(html, /id="rules"|id="matches"|id="placements"|Join as a player/);
  const overview = render("overview", snapshot("registration_open"));
  assert.doesNotMatch(overview, /Approve entry|Close registration/);
});
test("member views preserve own consent and opponent confirmation while restricting administrator actions", () => {
  const member = snapshot("registration_open", "player");
  const overview = render("overview", member, "new-player");
  assert.match(overview, /Join as a player/); assert.match(overview, /I accept the published rules/);
  assert.doesNotMatch(overview, /href="\/tournaments\/event\/admin"|Manage tournament|Approve entry/);
  const matches = render("matches", snapshot("active", "player"), "player");
  assert.match(matches, /Confirm opponent/); assert.doesNotMatch(matches, /Save &amp; Validate|Record a fair draw/);
  assert.match(matches, /An administrator must record a draw/);
  const denied = render("admin", member, "player");
  assert.match(denied, /Only tournament administrators/); assert.doesNotMatch(denied, /id="entries"|Close registration|Approve entry/);
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
  const html = render("overview", data);
  assert.match(html, /Guest · administrator registered/); assert.match(html, /Guest One &amp; Guest Two/);
  assert.doesNotMatch(html, /0\/2 accepted|2\/2 accepted/);
});



test("administrator-enrolled real accounts show actual names and never pretend personal acceptance or invitations", () => {
  const data = snapshot("registration_open", "player");
  data.teams = [{ id: "admin-entry", name: "Verified pair", entry_state: "approved", admin_definition_id: "definition", registered_by: "owner" }];
  data.team_members = [{ id: "one", team_id: "admin-entry", user_id: "player", membership_status: "active", admission_source: "administrator", consented_at: null, consented_definition_id: null, display_name: "Real Player One" }, { id: "two", team_id: "admin-entry", user_id: "opponent", membership_status: "active", admission_source: "administrator", consented_at: null, consented_definition_id: null, display_name: "Real Player Two" }];
  const html = render("overview", data, "player");
  assert.match(html, /Administrator enrolled · Picktennt account/);
  assert.match(html, /Real Player One &amp; Real Player Two/);
  assert.doesNotMatch(html, /0\/2 accepted|2\/2 accepted|Join as a player|Request my entry|Accept invitation/);
});

test("registered-account enrollment form is available only to current native administrators while registration is open", () => {
  for (const [role, actor] of [["owner", "owner"], ["admin", "delegate"]]) {
    const html = render("admin", snapshot("registration_open", role), actor);
    assert.match(html, /Register existing Picktennt players|Player’s Picktennt username|Partner’s Picktennt username/);
    assert.match(html, /Find registered players|Enroll registered entry/);
    assert.doesNotMatch(html, /No email or Picktennt account is needed/);
  }
  for (const state of ["draft", "registration_closed", "ready", "active", "completed"]) assert.doesNotMatch(render("admin", snapshot(state)), /Enroll registered entry/);
  assert.doesNotMatch(render("admin", snapshot("registration_open", "player"), "player"), /Enroll registered entry/);
  assert.doesNotMatch(render("overview", snapshot("registration_open")), /Enroll registered entry/);
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
  assert.match(html, /Find administrator account|Reason for administrator change|Review administrator change/);
  assert.match(html, /Choose removal for Helper Account/);
  assert.doesNotMatch(html, /Choose removal for Organizer/);
  assert.doesNotMatch(html, /I reviewed this administrator access change and want to proceed/);
  data.caller_role = "admin";
  const delegate = render("admin", data, "delegate");
  assert.doesNotMatch(delegate, /Manage tournament administrators|Find administrator account|Choose removal/);
  assert.doesNotMatch(render("overview", data), /Manage tournament administrators/);
});

test("missing administrator snapshot does not fabricate administrators or enable blind role changes", () => {
  const html = render("admin", snapshot("active"));
  assert.match(html, /Refresh the tournament to load its current administrators/);
  assert.doesNotMatch(html, /Choose removal|Find administrator account/);
});

test("registration Matches shows the plan, real players and team management without scoring or generated fixtures", () => {
  const data = snapshot("registration_open");
  data.team_members[0].display_name = "Alicia Player";
  const html = render("matches", data);
  assert.match(html, /Planned tournament · registration draft|TBD/);
  assert.match(html, /Alicia Player|Alpha|Pending entry/);
  assert.match(html, /Register existing Picktennt players|Approve entry|Edit tournament/);
  assert.doesNotMatch(html, /Validate saved score|Save &amp; Validate|Confirm opponent/);
  const player = render("matches", { ...data, caller_role: "player" }, "player");
  assert.match(player, /Your entry|Alicia Player/);
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
  assert.doesNotMatch(render("overview", data), /DUPR submission/);
  data.event!.results_under_review = true;
  assert.match(render("admin", data), /Resolve results under review before selecting or submitting/);
});
