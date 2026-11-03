"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DefinitionNode, TournamentDefinition } from "@/lib/tournament-builder/definition";
import { useTournamentCommand } from "./use-command";

const selectClass = "h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm";
function localTimestamp(value: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("Choose valid dates.");
  const offset = -instant.getTimezoneOffset();
  return `${value}:00${offset >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}
export function NewTournamentDraft({ actorId, mcpUrl }: { actorId: string; mcpUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState("");
  const action = useTournamentCommand(actorId, undefined, 0, async (receipt) => { router.push(`/tournaments/${receipt.tournament_id}/builder`); });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const format = String(form.get("format")), doubles = form.get("entry_type") === "fixed_doubles";
      const nodes: DefinitionNode[] = [{ id: "registration", module: "registration@1" }, { id: "entries", module: "entries@1", from: "registration" }];
      if (format !== "elimination") nodes.push({ id: "round_robin", module: "round_robin@1", from: "entries" }, { id: "standings", module: "standings@1", from: "round_robin" });
      if (format === "playoff") nodes.push({ id: "qualify", module: "qualify@1", from: "standings", config: { count: Number(form.get("qualifiers")) as 2 | 4 } });
      if (format !== "round_robin") nodes.push({ id: "elimination", module: "elimination@1", from: format === "playoff" ? "qualify" : "entries", config: { seeding: format === "playoff" ? "ranked" : "draw", bronze: form.get("bronze") === "on" } });
      nodes.push({ id: "placements", module: "placements@1", from: nodes.at(-1)!.id });
      const definition: TournamentDefinition = {
        schema_version: "1.0", event: { name: String(form.get("name")), venue_name: String(form.get("venue")), starts_at: localTimestamp(String(form.get("starts"))), expected_end_at: localTimestamp(String(form.get("ends"))), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, visibility: form.get("visibility") as "public" | "unlisted", courts: Number(form.get("courts")) },
        registration: { mode: form.get("admission") as "open" | "approval", entry_type: doubles ? "fixed_doubles" : "singles", min_entries: Number(form.get("minimum")), max_entries: Number(form.get("capacity")), closes_at: localTimestamp(String(form.get("closes"))), partner_consent: false, organizer_plays: form.get("organizer_plays") === "on" },
        policies: { match: { version: 1, games: 1, target: Number(form.get("target")) as 11 | 15 | 21, win_by: Number(form.get("win_by")) as 1 | 2, cap: null, scoring: form.get("scoring") as "side_out" | "rally" }, ranking: { version: 1, order: ["wins_desc", "differential_desc", "points_for_desc"], final_tie: "recorded_draw" }, confirmation: "opponent_or_admin_v1", withdrawal: "stage_sensitive_v1", correction: "impact_review_void_and_replay_v1" },
        scheduling: { estimated_slot_minutes: Number(form.get("slot")), minimum_rest_minutes: 0, contingency_minutes: Number(form.get("buffer")) }, nodes,
      };
      await action.run("createDraft", { definition });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the tournament details."); }
  }
  const select = (label: string, name: string, values: [string, string][], initial?: string) => <label className="text-sm font-medium text-gray-700">{label}<select name={name} className={`${selectClass} mt-1.5`} defaultValue={initial}>{values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  return <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 md:p-8"><div><Link href="/tournaments" className="text-sm text-brand-600">← Tournaments</Link><h1 className="mt-3 text-3xl font-black text-gray-900">Build your tournament</h1><p className="mt-2 text-gray-500">Start with your format, then review every rule before opening registration.</p></div>
    <Card><CardHeader><CardTitle>Create with your AI assistant</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-gray-600"><p>Add this remote MCP address in ChatGPT or Claude, connect your Picktennt account, and describe your tournament. Your assistant can prepare drafts for your review here.</p><code className="block break-all rounded-lg bg-gray-50 p-3">{mcpUrl}</code><Button variant="secondary" type="button" onClick={() => void navigator.clipboard.writeText(mcpUrl)}>Copy connection address</Button><Link href="/oauth/connections" className="ml-3 text-brand-600 underline">Manage AI access</Link></CardContent></Card>
    {action.notice}{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <Card><CardHeader><CardTitle>Or start with a format</CardTitle></CardHeader><CardContent><form onSubmit={(event) => void submit(event)} className="space-y-5"><fieldset disabled={action.disabled} className="space-y-4 disabled:opacity-60"><div className="grid gap-4 sm:grid-cols-2"><Input label="Tournament name" name="name" required maxLength={120} /><Input label="Venue" name="venue" required />{select("Format", "format", [["round_robin", "Round robin"], ["playoff", "Round robin → playoffs"], ["elimination", "Elimination bracket"]])}{select("Entries", "entry_type", [["singles", "Singles"], ["fixed_doubles", "Fixed doubles"]])}<Input label="Starts" name="starts" type="datetime-local" required /><Input label="Expected finish" name="ends" type="datetime-local" required /><Input label="Registration deadline" name="closes" type="datetime-local" required />{select("Registration", "admission", [["approval", "Organizer approval"], ["open", "Open admission"]])}<Input label="Minimum entries" name="minimum" type="number" min={2} max={16} defaultValue={2} required /><Input label="Maximum entries" name="capacity" type="number" min={2} max={16} defaultValue={4} required /><Input label="Courts" name="courts" type="number" min={1} max={8} defaultValue={2} required />{select("Visibility", "visibility", [["unlisted", "Unlisted (share a link)"], ["public", "Public"]])}{select("Playoff qualifiers", "qualifiers", [["2", "Top 2"], ["4", "Top 4"]], "4")}{select("Points to win", "target", [["11", "11 points"], ["15", "15 points"], ["21", "21 points"]])}{select("Winning margin", "win_by", [["2", "Win by 2"], ["1", "Win by 1"]])}{select("Scoring", "scoring", [["side_out", "Side-out"], ["rally", "Rally"]])}<Input label="Estimated match minutes" name="slot" type="number" min={1} defaultValue={20} required /><Input label="Contingency minutes" name="buffer" type="number" min={0} defaultValue={30} required /></div><p className="text-xs text-gray-500">Dates use your device’s time zone. Rankings use wins, point differential, then points scored. Remaining ties require a recorded draw.</p><label className="block text-sm"><input type="checkbox" name="bronze" className="mr-2" />Play a bronze match when the bracket has semifinal losers</label><label className="block text-sm"><input type="checkbox" name="organizer_plays" className="mr-2" />I may join as a player (I will register separately)</label><Button type="submit">Create draft and review</Button></fieldset></form></CardContent></Card>
    <details className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer font-medium">Advanced: import a prepared definition</summary><textarea aria-label="Prepared tournament definition" className="mt-3 min-h-48 w-full rounded-xl border p-3 font-mono text-xs" value={advanced} onChange={(event) => setAdvanced(event.target.value)} disabled={action.disabled} /><Button className="mt-3" disabled={action.disabled || !advanced.trim()} onClick={() => { try { void action.run("createDraft", { definition: JSON.parse(advanced) }); } catch { setError("The prepared definition is not valid JSON."); } }}>Import draft</Button></details>
  </div>;
}
