"use client";
import { useState } from "react";
import { presentStandings } from "@/lib/tournament-builder/standings-presentation";
import { ShareButton } from "@/components/tournament/share-button";
import { Badge } from "@/components/ui/badge";
import { generateJoinUrl } from "@/lib/utils";
import { PlannedMatches } from "./planned-matches";
import { DuprSubmission } from "./dupr-submission";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import type { DefinitionPreview } from "@/lib/tournament-builder/preview";
import { useTournamentCommand } from "./use-command";
import { BuilderMatch } from "./match-card";
import { DraftPolicyEditor } from "./draft-policy-editor";
import { DraftSetupEditor, draftFieldId, draftSetupLabel, draftSetupError, hasDraftSetupField } from "./draft-setup-editor";
import { OwnerAdministrators } from "./owner-administrators";
import { matchEditorKey, matchTitle, orderedMatches, reachedStage, unresolvedSideLabel } from "./match-presentation";
import { GraphReview, graphNodeLabel } from "./graph-review";
import { resolvedDefinition } from "@/lib/tournament-builder/resolved-definition";
import { GroupFinalization } from "./group-finalization";
import { RevisionEditor } from "./revision-editor";
import { IndividualRegistration } from "./individual-registration";
import { PlayerStats } from "./player-stats";
import { tournamentTeamLabel } from "@/lib/tournament-builder/team-label";
import { generationProblems } from "@/lib/tournament-builder/generation-readiness";
import { PlayerActions } from "./player-actions";
import { TeamActions } from "./team-actions";
import { individualRoster, positionedMembers } from "@/lib/tournament-builder/individual-roster";
import { TournamentTopNav, TournamentBottomNav } from "@/components/tournament/tournament-bottom-nav";
import { MobileHeader } from "@/components/layout/navbar";
import { BookOpen, CalendarClock, MapPin, Trophy, Users } from "lucide-react";
import { tournamentPath, type TournamentView } from "@/lib/tournament-builder/navigation";

type Snapshot = CommandSnapshot & { caller_role?: string };
export type TournamentBuilderView = TournamentView;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const display = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const moduleNames: Record<string, string> = { registration: "Registration", entries: "Entries", round_robin: "Round robin", cross_play: "Cross-group play", standings: "Rankings", qualify: "Qualifiers", elimination: "Playoffs", placements: "Final places" };
const rankingNames: Record<string, string> = { wins_desc: "Wins", differential_desc: "Point differential", points_for_desc: "Points scored", points_against_asc: "Fewest points conceded", points_for_in_losses_desc: "Points scored in losses" };
function currentDefinition(snapshot: Snapshot) { return resolvedDefinition(snapshot); }

export function TournamentBuilder({ actorId, initialSnapshot, initialPreview, view = "builder" }: { actorId: string; initialSnapshot: Snapshot; initialPreview: DefinitionPreview; view?: TournamentBuilderView }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [preview, setPreview] = useState(initialPreview);
  const [editor, setEditor] = useState(JSON.stringify(currentDefinition(initialSnapshot)?.definition ?? {}, null, 2));
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [rosterReviewed, setRosterReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const [matchesView, setMatchesView] = useState<"mine" | "all">("mine");
  const event = snapshot.event!;
  const id = event.id, state = String(event.modular_state);
  const owner = event.created_by === actorId;
  const admin = owner || snapshot.caller_role === "admin";
  const full = state === "draft" || view === "builder";
  const showOverview = full || view === "overview";
  const showMatches = full || view === "matches";
  const showStandings = full || view === "standings";
  const showTies = showStandings;
  const showAdmin = admin && (full || view === "admin");
  const showEntries = showOverview || showAdmin;
  const manageEntries = showAdmin;
  const beforeRosterLock = ["draft", "registration_open", "registration_closed"].includes(state);
  const definitionRow = currentDefinition(snapshot);
  const definition = object(definitionRow?.definition), details = object(definition.event), registration = object(definition.registration), policies = object(definition.policies), matchRules = object(policies.match), ranking = object(policies.ranking), scheduling = object(definition.scheduling);
  let parsedEditor: Record<string, unknown> | null = null;
  try { const parsed: unknown = JSON.parse(editor); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) parsedEditor = parsed as Record<string, unknown>; } catch {}
  const unsaved = editor !== JSON.stringify(definitionRow?.definition ?? {}, null, 2);
  async function reload() {
    const response = await fetch(`/api/tournament-builder/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not reload this tournament.");
    const result = await response.json() as { snapshot: Snapshot; preview: DefinitionPreview };
    setSnapshot(result.snapshot); setPreview(result.preview);
    setEditor(JSON.stringify(currentDefinition(result.snapshot)?.definition ?? {}, null, 2));
    setReviewed(false); setAcknowledged([]); setRosterReviewed(false);
    return result.snapshot;
  }
  const action = useTournamentCommand(actorId, id, Number(event.revision), async (receipt) => {
    const current = await reload();
    if (state === "draft" && current.event && current.event.modular_state !== "draft") window.location.replace(tournamentPath(id, "overview"));
    const result = object(receipt.data);
    setMessage(result.admission_error === "CAPACITY_FULL" ? "Your consent was saved, but the tournament is full. Your entry is still pending." : receipt.status === "stale" ? "Current information loaded. Review your next action." : "Saved. The tournament is up to date.");
  });
  async function run(command: string, data: Record<string, unknown>) { setMessage(""); await action.run(command, data); }
  function entryLabel(value: unknown) {
    const index = snapshot.teams.findIndex((row) => row.id === value);
    return index < 0 ? "Waiting for entry" : tournamentTeamLabel(snapshot, snapshot.teams[index], registration.entry_type === "fixed_doubles", index + 1);
  }
  function matchLabel(value: string) {
    const match = snapshot.matches.find((row) => row.id === value);
    return match ? `Court ${display(match.court_number)}: ${entryLabel(match.team_a_id)} vs ${entryLabel(match.team_b_id)}` : "Dependent match";
  }
  function members(team: StorageRow) { return snapshot.team_members.filter((row) => row.team_id === team.id && !["cancelled", "withdrawn"].includes(String(row.membership_status))); }
  function matchPlayerNames(match: StorageRow, teamId: unknown) {
    if (!teamId) return [];
    const side = teamId === match.team_a_id ? "a" : teamId === match.team_b_id ? "b" : null;
    if (!side) return [];
    const positions = [1, 2].filter(position => typeof match[`player_${side}${position}_id`] === "string");
    if (positions.length) return positions.map(position => {
      const id = match[`player_${side}${position}_id`];
      const name = match[`player_${side}${position}_name`] ?? snapshot.team_members.find(member => member.user_id === id)?.display_name;
      return typeof name === "string" && name.length > 0 ? name : "Player";
    });
    if (["validated", "walkover"].includes(String(match.status)) && snapshot.team_members.some(member => member.team_id === teamId && ["cancelled", "withdrawn"].includes(String(member.membership_status)))) return [];
    const current = members({ id: String(teamId) }).filter(member => member.membership_status === "active");
    return positionedMembers(current, registration.entry_type === "fixed_doubles" ? 2 : 1).map(member => member?.display_name).filter((name): name is string => typeof name === "string" && name.length > 0);
  }
  const ownMemberships = snapshot.team_members.filter((row) => row.user_id === actorId && ["active", "pending"].includes(String(row.membership_status)));
  const approvedEntries = snapshot.teams.filter((row) => row.entry_state === "approved");
  const pendingIndividuals = snapshot.team_members.filter(member => member.membership_status === "pending" && Number.isInteger(member.player_slot) && snapshot.tournament_players.some(player => player.user_id === member.user_id && player.status === "pending") && snapshot.teams.some(team => team.id === member.team_id && team.entry_state === "approved" && Number.isInteger(team.registration_slot)));
  const pendingTeams = snapshot.teams.filter(team => team.entry_state === "pending");
  const rosterProblems = generationProblems(snapshot, registration.entry_type === "fixed_doubles", Number(registration.min_entries ?? 2), definitionRow?.id);
  const warnings = [...new Set(preview.warnings.map((warning) => warning.code))];
  const nodes = Array.isArray(definition.nodes) ? definition.nodes.map(object) : [];
  const graph = definition.schema_version === "2.0";
  const initialGroups = graph ? nodes.filter(node => node.module === "round_robin@2" && Array.isArray(node.inputs) && node.inputs.every(source => object(source).kind === "seed")).map(node => ({ id: String(node.id), capacity: (node.inputs as unknown[]).length })) : [];
  const rankingStages = snapshot.stages.filter((stage) => stage.module_id === "standings" || (stage.module_id === "round_robin" && Number(stage.module_version) === 2) || stage.module_id === "cross_play");
  const standings = presentStandings(snapshot.standings, snapshot.teams, snapshot.disciplinary_excluded_team_ids);
  const standingsGroups = graph ? rankingStages.map((stage) => ({ id: stage.id, label: graphNodeLabel(String(stage.node_id), definition), rows: standings.filter((row) => row.stage_id === stage.id) })).filter((group) => group.rows.length > 0) : [{ id: "rankings", label: "", rows: standings }];
  const rankedEntries = new Set(standingsGroups.flatMap(group => group.rows.map(row => row.team_id)));
  const unrankedRows: StorageRow[] = approvedEntries.filter(entry => !rankedEntries.has(entry.id)).map(entry => ({ id: `unranked-${entry.id}`, team_id: entry.id, rank: null, wins: 0, losses: 0, points_for: 0, points_against: 0 }));
  const approvedTeamIds = new Set(approvedEntries.map(entry => entry.id));
  const placedPlayers = new Set(snapshot.team_members.filter(member => member.membership_status === "active" && approvedTeamIds.has(String(member.team_id))).map(member => member.user_id));
  const unplacedPlayers = snapshot.tournament_players.filter(player => player.status === "approved" && !placedPlayers.has(player.user_id)).map(player => ({ id: `unplaced-${player.id}`, team_id: null, display_name: player.display_name, rank: null, wins: 0, losses: 0, points_for: 0, points_against: 0 }));
  unrankedRows.push(...unplacedPlayers);
  if (unrankedRows.length) standingsGroups.push({ id: "unranked", label: "Not yet ranked", rows: unrankedRows });
  const heading = (title: string, content: React.ReactNode) => <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-4">{content}</CardContent></Card>;
  const ruleNotices = <>
      {preview.generationReady === false && <p className="rounded-lg bg-amber-50 p-3 text-sm">Registration can open with available group slots. Knockout connections are pending; review the completed plan and actual groups before generating games.</p>}{[...preview.errors, ...preview.missing_fields].filter(issue => !(state === "draft" && parsedEditor && issue.code === "MISSING_FIELD" && hasDraftSetupField(issue.field_path)) || !!draftSetupError(parsedEditor!, issue.field_path)).map((issue, index) => <p key={`${issue.field_path}-${index}`} className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state === "draft" && admin && hasDraftSetupField(issue.field_path) ? <a className="underline" href={`#${draftFieldId(issue.field_path)}`}>{issue.code === "MISSING_FIELD" ? `${draftSetupLabel(issue.field_path)} is required.` : issue.message}</a> : issue.message}</p>)}
      {preview.warnings.map((warning, index) => <p key={`${warning.code}-${index}`} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{warning.message}</p>)}
  </>;
  const rulesContent = <>{graph ? <GraphReview definition={definition} /> : <div className="flex flex-wrap gap-2" aria-label="Tournament format">{nodes.map((node, index) => <span key={String(node.id)} className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold">{index > 0 ? "→ " : ""}{moduleNames[String(node.module).split("@")[0]] ?? "Stage"}</span>)}</div>}<dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Venue and courts</dt><dd>{display(event.court_name ?? details.venue_name)} · {display(details.courts)} courts</dd></div><div><dt className="text-gray-500">Entries</dt><dd>{registration.entry_type === "fixed_doubles" ? "Fixed doubles; individual positions" : "Singles"} · {display(registration.min_entries)}–{display(registration.max_entries)} entries</dd></div><div><dt className="text-gray-500">Starts / expected finish</dt><dd>{display(details.starts_at)}<br />{display(details.expected_end_at)}<br />{display(details.timezone)}</dd></div><div><dt className="text-gray-500">Registration</dt><dd>{registration.mode === "open" ? "Open admission" : "Organizer approval"}<br />Closes {display(registration.closes_at)}</dd></div><div><dt className="text-gray-500">Scoring</dt><dd>One game to {display(matchRules.target)}, win by {display(matchRules.win_by)} · {display(matchRules.scoring).replaceAll("_", " ")} · no cap</dd></div><div><dt className="text-gray-500">Ranking</dt><dd>{Array.isArray(ranking.order) ? ranking.order.map((key) => rankingNames[String(key)] ?? "Ranking criterion").join(" → ") : "Incomplete"}; remaining ties use a recorded draw</dd></div><div><dt className="text-gray-500">Court workload</dt><dd>Up to {preview.maximumMatches ?? "—"} matches · {display(scheduling.estimated_slot_minutes)} min / match<br />No enforced rest between games · {display(scheduling.contingency_minutes)} min contingency{preview.estimatedMinutes !== undefined && <><br />Estimated duration: {preview.estimatedMinutes} min<br />Event window: {display(details.starts_at)} – {display(details.expected_end_at)}</>}</dd></div><div><dt className="text-gray-500">Third place</dt><dd>{preview.thirdPlace === "shared" ? "Shared third place" : preview.thirdPlace === "bronze_match" ? "Bronze match" : preview.thirdPlace === "ranking" ? "Determined by ranking" : "Not applicable"}</dd></div></dl><p className="text-xs text-gray-500">Scores count after a registered tournament player or an administrator validates them. An organizer who plays must join separately.</p>
      {state === "draft" && ruleNotices}

      {state === "draft" && admin && <div className="space-y-4 border-t pt-4">{parsedEditor && <DraftSetupEditor definition={parsedEditor} savedDefinition={definition} issues={[...preview.errors, ...preview.missing_fields]} disabled={action.disabled} onChange={(changed) => { setEditor(JSON.stringify(changed, null, 2)); setReviewed(false); setAcknowledged([]); }} />}{owner && parsedEditor && <DraftPolicyEditor definition={parsedEditor} disabled={action.disabled} onChange={(changed) => { setEditor(JSON.stringify(changed, null, 2)); setReviewed(false); setAcknowledged([]); }} />}<details><summary className="cursor-pointer text-sm font-medium">Advanced: edit the complete definition</summary><textarea aria-label="Tournament definition" className="mt-3 min-h-80 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs" disabled={action.disabled} value={editor} onChange={(e) => { setEditor(e.target.value); setReviewed(false); setAcknowledged([]); }} /></details>{!parsedEditor && <p className="text-sm text-red-600">Fix the advanced definition before saving.</p>}<Button disabled={action.disabled || !unsaved || !parsedEditor} onClick={() => void run("updateDraft", { definition: parsedEditor })}>Save changes and refresh review</Button>
        {owner && <p className="text-sm text-gray-600">{unsaved ? "Save your changes, then review the updated rules to continue." : !preview.valid ? "Complete the red fields and save your changes before continuing." : "Next: review the saved rules and approve opening registration."}</p>}{owner && <fieldset disabled={action.disabled || unsaved || !preview.valid} className="space-y-3 border-t pt-4 disabled:opacity-60"><label className="block text-sm"><input className="mr-2" type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed these rules, the format, and the schedule.</label>{warnings.map((code) => <label key={code} className="block text-sm"><input className="mr-2" type="checkbox" checked={acknowledged.includes(code)} onChange={(e) => setAcknowledged(e.target.checked ? [...acknowledged, code] : acknowledged.filter((item) => item !== code))} />I accept the {code === "INSUFFICIENT_TIME" ? "venue time warning" : "warning above"}.</label>)}<Button disabled={!reviewed || acknowledged.length !== warnings.length || !preview.definitionHash} onClick={() => void run("publishTournament", { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: acknowledged })}>Approve rules and open registration</Button><p className="text-xs text-gray-500">Published rules are fixed. This approval uses the exact version you just reviewed.</p></fieldset>}</div>}
    </>;
  const progress = snapshot.stages.length > 0 && heading("Progress", <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{snapshot.stages.map((stage) => <div key={stage.id} className="rounded-xl bg-gray-50 p-3"><p className="text-sm font-semibold">{graph ? stage.module_id === "match" ? `Match ${String(stage.node_id)}` : `${moduleNames[String(stage.module_id)] ?? "Stage"} · ${graphNodeLabel(String(stage.node_id), definition)}` : moduleNames[String(stage.module_id)] ?? "Stage"}</p><p className="text-xs text-gray-500">{display(stage.state)}{stage.blocked_code ? " · Waiting for a tie or result decision" : ""}</p></div>)}</div>);
  const publishedOverview = view === "overview" && state !== "draft";
  const rosterEditable = individualRoster(snapshot)?.editable === true;
  const playerCount = snapshot.tournament_players.filter(player => player.status === "approved").length;
  const playerCapacity = Number(registration.max_entries) * (registration.entry_type === "fixed_doubles" ? 2 : 1);
  const day = typeof details.starts_at === "string" ? new Date(`${details.starts_at.slice(0, 10)}T12:00:00Z`) : null;
  const startDay = day && !Number.isNaN(day.getTime()) ? day.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : undefined;
  return <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-24">{!publishedOverview && <header className="space-y-3"><Link href="/tournaments" className="text-sm text-brand-600">← Tournaments</Link><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant={state === "active" ? "success" : "default"}>{state.replaceAll("_", " ")}</Badge><h1 className="mt-2 text-2xl font-black text-gray-900">{display(event.name ?? details.name)}</h1></div><Button variant="secondary" disabled={action.disabled} onClick={() => void reload().catch(() => setMessage("Could not reload. Try again."))}>Refresh</Button></div><div className="flex flex-wrap gap-4 text-sm text-gray-500">{state === "draft" && <><a href="#rules">Rules</a><a href="#entries">Entries</a><a href="#matches">Matches</a><a href="#placements">Placements</a></>}</div></header>}
    {publishedOverview && <MobileHeader title={display(event.name ?? details.name)} back="/tournaments" />}
    {state !== "draft" && <TournamentTopNav tournamentId={id} isAdmin={admin} />}
    {admin && state === "ready" && (showAdmin || showMatches) && <Button disabled={action.disabled} onClick={() => void run("startTournament", {})}>Start tournament</Button>}
    {state !== "draft" && showAdmin && typeof event.join_code === "string" && <Card><CardContent className="space-y-3 py-4"><p className="text-sm text-gray-500">Join code <span className="ml-2 font-mono font-bold tracking-widest text-brand-600">{event.join_code}</span></p><ShareButton joinCode={event.join_code} joinUrl={generateJoinUrl(event.join_code)} large /></CardContent></Card>}
    {publishedOverview && <Card className="overflow-hidden border-brand-100 shadow-sm">
      <div className="h-3 bg-gradient-to-r from-brand-400 to-brand-600" />
      <CardContent className="pt-5 pb-5">
        <h1 className="text-2xl font-black text-gray-900 leading-tight">{display(event.name ?? details.name)}</h1>
        <div className="flex flex-wrap gap-2 mt-3">
          <Badge variant="default" className="text-xs"><Users className="h-3 w-3 mr-1" />{playerCount} / {Number.isFinite(playerCapacity) ? playerCapacity : "—"} players</Badge>
          <Badge variant="secondary">{registration.entry_type === "fixed_doubles" ? "Doubles" : "Singles"}</Badge>
          <Badge variant="secondary">{display(details.courts)} courts</Badge>
          <Badge variant={state === "registration_open" ? "success" : "secondary"}>{state === "registration_open" ? "Open Registration" : state.replaceAll("_", " ")}</Badge>
        </div>
        <div className="mt-3 space-y-1 text-xs text-gray-500">
          {startDay && <p className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />{startDay}</p>}
          {(typeof event.court_name === "string" || typeof details.venue_name === "string" || typeof event.court_address === "string") && <p className="flex items-start gap-1.5"><MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /><span><span className="font-medium text-gray-700">{display(event.court_name ?? details.venue_name)}</span>{typeof event.court_address === "string" && <> · {event.court_address}</>}</span></p>}
        </div>
        {typeof event.join_code === "string" && <div className="mt-4"><ShareButton joinCode={event.join_code} joinUrl={generateJoinUrl(event.join_code)} large /></div>}
        <details id="rules" className="mt-4 border-t border-gray-100 pt-4"><summary className="cursor-pointer text-sm font-semibold text-brand-600"><BookOpen className="inline h-4 w-4 mr-1" />View more · Format and rules</summary><div className="mt-4 space-y-4">{rulesContent}</div></details>
      </CardContent>
    </Card>}
    {view === "admin" && state !== "draft" && (admin ? heading("Tournament administration", <p className="text-sm text-gray-600">Manage entries and event status here. <Link className="font-semibold text-brand-600" href={`/tournaments/${id}/matches`}>Open Matches to enter, validate, or correct scores.</Link></p>) : <p role="alert">Only tournament administrators can manage this event.</p>)}
    {action.notice}{message && <p aria-live="polite" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{message}</p>}{event.results_under_review === true && <p className="rounded-xl bg-amber-50 p-4 text-amber-900">Results are under review. Final placements are temporarily withheld.</p>}
    {showOverview && state === "draft" && <section id="rules">{heading("Review the tournament", rulesContent)}</section>}
    {view === "overview" && state !== "draft" && ruleNotices}
    {showMatches && beforeRosterLock && <section id="matches">{heading("Matches", state === "draft" ? <PlannedMatches definition={definition} /> : <p className="text-sm text-gray-500">Matches will appear here after the administrator generates them.</p>)}</section>}
    {publishedOverview && progress}
    {state !== "draft" && showEntries && <section id="entries">{heading("Entries and registration", <><p className="text-sm text-gray-600">{pendingIndividuals.length > 0 ? <>{approvedEntries.length} team entries · {pendingIndividuals.length} player {pendingIndividuals.length === 1 ? "request" : "requests"} pending.</> : <>{approvedEntries.length} approved of {display(registration.max_entries)} available entries.</>}</p><fieldset disabled={action.disabled} className="space-y-4 disabled:opacity-60">
      {(showOverview || manageEntries) && state !== "draft" && state !== "cancelled" && <IndividualRegistration snapshot={snapshot} actorId={actorId} definitionId={definitionRow?.id ?? ""} doubles={registration.entry_type === "fixed_doubles"} maxEntries={Number(registration.max_entries ?? 0)} admin={showAdmin} owner={owner} matchLabel={matchLabel} disabled={action.disabled} run={run} />}
      {!publishedOverview && <div className="space-y-3">{snapshot.teams.filter(team => showAdmin ? team.registration_slot == null && team.entry_state !== "pending" : !publishedOverview || state === "cancelled" || team.registration_slot == null).map((team) => { const guests = Array.isArray(team.guest_players) ? team.guest_players.map(object) : []; const isGuest = guests.length > 0 || Boolean(team.guest_definition_id); const administratorEnrolled = Boolean(definitionRow?.id) && team.admin_definition_id === definitionRow?.id && Boolean(team.registered_by); const roster = members(team), own = roster.some((member) => member.user_id === actorId), complete = roster.length === (registration.entry_type === "fixed_doubles" ? 2 : 1) && roster.every((member) => member.consented_at); return <div key={team.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3"><div><strong className="text-sm">{entryLabel(team.id)}{own ? " · Your entry" : ""}</strong>{isGuest ? <><p className="text-xs font-medium text-brand-700">Guest · administrator registered</p><p className="text-sm text-gray-600">{guests.map((guest) => display(guest.name)).join(" & ")}</p></> : administratorEnrolled ? <><p className="text-xs font-medium text-brand-700">Administrator enrolled · Picktennt account</p><p className="text-sm text-gray-600">{roster.map((member) => display(member.display_name)).join(" & ")}</p></> : <><p className="text-sm text-gray-600">{roster.map((member) => display(member.display_name)).join(" & ")}</p><p className="text-xs text-gray-500">{team.registration_slot != null ? `${roster.length} individually registered players` : <>{display(team.entry_state).replaceAll("_", " ")} · {roster.filter((member) => member.consented_at).length}/{registration.entry_type === "fixed_doubles" ? 2 : 1} accepted</>}</p></>}</div><div className="flex flex-wrap gap-2">{manageEntries && state === "registration_open" && team.entry_state === "pending" && <Button size="sm" disabled={!complete} onClick={() => void run("approveEntry", { entry_id: team.id })}>Approve entry</Button>}{(showOverview || showMatches) && own && team.registration_slot == null && rosterEditable && ["pending", "approved"].includes(String(team.entry_state)) && <Button size="sm" variant="outline" onClick={() => void run("cancelEntry", { entry_id: team.id })}>Cancel my entry</Button>}</div>{showAdmin && team.entry_state === "approved" && <div className="w-full space-y-2">{roster.filter(member => member.membership_status === "active").map(member => <div key={member.id}><span className="text-xs">{display(member.display_name)}</span><PlayerActions snapshot={snapshot} team={team} member={member} disabled={action.disabled} run={run} /></div>)}<TeamActions snapshot={snapshot} team={team} label={entryLabel} disabled={action.disabled} owner={owner} matchLabel={matchLabel} run={run} /></div>}</div>; })}</div>}
      {showAdmin && <div className="space-y-3 border-t pt-4">{state === "registration_open" && <><Button disabled={rosterProblems.length > 0 || action.disabled} onClick={() => { if (window.confirm("Close registration and review the schedule before generating games?")) void run("closeRegistration", {}); }}>Generate games</Button>{rosterProblems.map(problem => <p role="status" className="text-sm text-amber-800" key={problem}>{problem}</p>)}<Button variant="outline" disabled={pendingIndividuals.length > 0} onClick={() => void run("closeRegistration", {})}>Close registration</Button>{pendingIndividuals.length > 0 && <p role="status" className="text-sm text-amber-800">Approve or reject pending player requests before closing registration.</p>}</>}{state === "registration_closed" && <><Button variant="outline" onClick={() => void run("reopenRegistration", {})}>Reopen registration</Button><label className="block text-sm"><input type="checkbox" className="mr-2" checked={rosterReviewed} onChange={(e) => setRosterReviewed(e.target.checked)} />I reviewed the current {approvedEntries.length} approved entries, their players, and how they were registered.</label><GroupFinalization key={`${event.revision}:${event.roster_revision}`} label={entryLabel} problems={rosterProblems} eventId={id} rosterRevision={event.roster_revision} groups={initialGroups} entries={approvedEntries} reviewed={rosterReviewed} pending={preview.generationReady === false} onChange={() => setRosterReviewed(false)} onGenerate={(payload) => void run("lockRoster", payload)} /></>}</div>}
    </fieldset>
    {manageEntries && registration.mode === "approval" && state === "registration_open" && (pendingIndividuals.length > 0 || pendingTeams.length > 0) && <section className="space-y-3" aria-label="Pending approvals"><h3 className="font-semibold">Pending approvals</h3><Input label="Reason for rejection" value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {pendingIndividuals.map(member => <div key={member.id} className="space-y-2 rounded-lg border p-3"><strong className="text-sm">{display(member.display_name)}</strong><p className="text-xs">{entryLabel(member.team_id)} · Position {display(member.player_slot)} held</p>{(!member.consented_at || member.consented_definition_id !== definitionRow?.id) && <p className="text-xs text-amber-800">The player must accept the current rules before approval. You may reject this request.</p>}<div className="flex flex-wrap gap-2"><Button size="sm" disabled={action.disabled || !member.consented_at || member.consented_definition_id !== definitionRow?.id} onClick={() => void run("approveIndividual", { user_id: member.user_id })}>Approve</Button><Button size="sm" variant="outline" disabled={action.disabled || !reason.trim()} onClick={() => void run("rejectIndividual", { user_id: member.user_id, reason: reason.trim() })}>Reject</Button></div></div>)}
      {pendingTeams.map(team => { const roster = members(team); const complete = roster.length === (registration.entry_type === "fixed_doubles" ? 2 : 1) && roster.every(member => member.consented_at && member.consented_definition_id === definitionRow?.id); return <div key={team.id} className="space-y-2 rounded-lg border p-3"><strong className="text-sm">{entryLabel(team.id)}</strong><p className="text-xs">{roster.map(member => display(member.display_name)).join(" / ") || "Waiting for player"}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={action.disabled || !complete} onClick={() => void run("approveEntry", { entry_id: team.id })}>Approve</Button><Button size="sm" variant="outline" disabled={action.disabled || !reason.trim()} onClick={() => void run("rejectEntry", { entry_id: team.id, reason: reason.trim() })}>Reject</Button></div>{!complete && <p className="text-xs text-amber-800">Waiting for all players to accept the rules.</p>}</div>; })}
    </div></section>}
    </>)}</section>}
    {showOverview && !publishedOverview && progress}
    {publishedOverview && ["active", "completed"].includes(state) && (admin || snapshot.tournament_players.some(player => player.user_id === actorId && player.status === "approved")) && <PlayerStats snapshot={snapshot} doubles={registration.entry_type === "fixed_doubles"} />}
    {showStandings && <section aria-label="Leaderboard" className="space-y-5">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black text-gray-900">Leaderboard</h2><Badge variant="secondary">{registration.entry_type === "fixed_doubles" ? "Doubles" : "Singles"}</Badge></div>
      {standingsGroups.every(group => group.rows.length === 0) ? <div className="py-16 text-center text-gray-400"><Trophy className="mx-auto mb-3 h-10 w-10 text-gray-200" /><p className="font-semibold">No results yet</p><p className="text-sm">Standings will appear after matches are validated</p></div> : <>
        {registration.entry_type === "fixed_doubles" && <h3 className="text-lg font-black text-gray-900">Team Standings</h3>}
        <div className="space-y-4">{standingsGroups.map((group) => <div key={group.id} className="space-y-2">{group.label && <h3 className="font-semibold">{group.label}</h3>}{[...group.rows].sort((a, b) => Number(a.eligible === false) - Number(b.eligible === false) || Number(a.rank ?? Infinity) - Number(b.rank ?? Infinity)).map((row) => {
          const rank = typeof row.rank === "number" ? row.rank : Number(row.rank);
          const medal = row.eligible !== false && row.rank != null && rank >= 1 && rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : null;
          const roster = members(snapshot.teams.find((team) => team.id === row.team_id) ?? { id: "" }).map((member) => member.display_name).filter((name): name is string => typeof name === "string" && name.length > 0);
          const name = row.team_id == null && typeof row.display_name === "string" ? row.display_name : entryLabel(row.team_id);
          const stage = row.eligible === false ? snapshot.teams.find(team => team.id === row.team_id)?.entry_state === "withdrawn" ? "Withdrawn" : "Ineligible" : reachedStage(row.team_id, snapshot);
          return <Card key={row.id} className={medal ? "border-brand-200 shadow-md" : ""}><CardContent className="grid grid-cols-[2rem_minmax(0,1fr)_3rem] items-center gap-3 py-3 px-4"><div className="text-center">{medal ? <span className="text-xl" aria-label={`Rank ${rank}`}>{medal}</span> : <span className="text-sm font-bold text-gray-400">{row.rank == null ? "—" : `#${display(row.rank)}`}</span>}</div><div className="min-w-0"><span className="block truncate whitespace-nowrap font-bold text-gray-900">{name}</span>{roster.length > 0 && name !== roster.join(" / ") && <span className="block text-xs text-gray-500">{roster.join(" / ")}</span>}{stage && <span className="text-xs font-semibold text-brand-600">{stage}</span>}{Boolean(row.tie_group) && <span className="text-xs text-gray-500">Tied</span>}<div className="text-xs text-gray-400">{display(row.wins)}W – {display(row.losses)}L · {display(row.points_for)}:{display(row.points_against)}</div></div><div className="justify-self-end text-right"><div className="text-lg font-black text-brand-500">{display(row.wins)}</div><div className="text-[10px] text-gray-400">wins</div></div></CardContent></Card>;
        })}</div>)}</div>
      </>}
    </section>}
    {showTies && state === "active" && rankingStages.map((stage) => { const output = object(stage.output); const ties = Array.isArray(output.ties) ? output.ties as string[][] : []; return ties.length ? <div key={stage.id}>{heading(graph ? `Resolve remaining ties · ${graphNodeLabel(String(stage.node_id), definition)}` : "Resolve remaining ties", <div className="space-y-3">{ties.map((tie, index) => <div key={`${stage.id}-${index}`} className="rounded-xl border border-gray-200 p-3"><p className="mb-2 text-sm">{tie.map(entryLabel).join(" · ")}</p>{admin ? <Button variant="outline" size="sm" disabled={action.disabled} onClick={() => void run("resolveTie", { stage_id: stage.id, entry_ids: tie, input_revision: output.inputRevision })}>Record a fair draw for this tied group</Button> : <p className="text-xs text-gray-600">An administrator must record a draw to resolve this tied group.</p>}</div>)}</div>)}</div> : null; })}
    {showMatches && !beforeRosterLock && <section id="matches">{heading("Matches", snapshot.matches.length ? <><div className="flex gap-2" aria-label="Match order">{!admin && <Button variant={matchesView === "mine" ? "default" : "outline"} size="sm" onClick={() => setMatchesView("mine")}>My matches first</Button>}<Button variant={admin || matchesView === "all" ? "default" : "outline"} size="sm" onClick={() => setMatchesView("all")}>All matches</Button></div><div className="space-y-4">{orderedMatches(snapshot.matches, snapshot.rounds, ownMemberships.map(member => String(member.team_id)), !admin && matchesView === "mine", graph).map((match) => <BuilderMatch key={matchEditorKey(match)} match={match} title={matchTitle(match, snapshot)} unresolvedA={unresolvedSideLabel(match, "a", snapshot)} unresolvedB={unresolvedSideLabel(match, "b", snapshot)} feedback={action.feedback?.matchId === match.id ? action.feedback.message : undefined} scorePolicy={{ target: Number(matchRules.target), win_by: Number(matchRules.win_by) }} label={entryLabel} playerNames={teamId => matchPlayerNames(match, teamId)} includeStage={admin || matchesView === "all"} ownEntry={ownMemberships.find((member) => member.membership_status === "active" && [match.team_a_id, match.team_b_id].includes(member.team_id))?.team_id as string | undefined} admin={admin && ["active", "completed"].includes(state)} canValidate={admin || snapshot.tournament_players.some(player => player.user_id === actorId && player.status === "approved")} disabled={action.disabled || !["active", "completed"].includes(state)} run={run} tournamentId={id} revision={Number(event.revision)} owner={owner} matchLabel={matchLabel} courts={Number(details.courts ?? 1)} />)}</div></> : <p className="text-sm text-gray-500">Matches appear after the organizer closes registration and locks the reviewed roster.</p>)}</section>}
    {showAdmin && owner && state !== "draft" && <OwnerAdministrators tournamentId={id} revision={Number(event.revision)} ownerId={actorId} admins={snapshot.admins} disabled={action.disabled} run={run} />}
    {showAdmin && owner && ["active", "ready", "registration_open", "registration_closed", "completed"].includes(state) && <details className="rounded-2xl border border-gray-100 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Organizer review and event controls</summary><div className="mt-4 space-y-3"><Input label="Reason for this action" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />{state === "completed" ? <Button variant="outline" disabled={action.disabled || !reason.trim()} onClick={() => void run("reopenResults", { reason: reason.trim() })}>Reopen results for review</Button> : <Button variant="danger" disabled={action.disabled || !reason.trim()} onClick={() => { if (window.confirm("Cancel this tournament? Active matches will end without a contest.")) void run("cancelTournament", { reason: reason.trim() }); }}>Cancel tournament</Button>}</div></details>}
    {manageEntries && ["registration_open", "registration_closed", "ready", "active", "completed"].includes(state) && <RevisionEditor key={String(event.revision)} snapshot={snapshot} definition={definition} disabled={action.disabled} run={run} />}
    {showAdmin && state === "completed" && <DuprSubmission tournamentId={id} revision={Number(event.revision)} matches={snapshot.matches} underReview={event.results_under_review === true} disabled={action.disabled} label={entryLabel} playerNames={matchPlayerNames} run={run} />}
    {state !== "draft" && <TournamentBottomNav tournamentId={id} isAdmin={admin} />}
  </div>;
}
