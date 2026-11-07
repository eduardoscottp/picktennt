import { Trophy } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const pending = new Set(["scheduled", "in_progress"]);

export function PlayerStats({ snapshot, doubles }: { snapshot: CommandSnapshot; doubles: boolean }) {
  const currentMatches = snapshot.matches.filter(match => match.is_current !== false && !match.voided_at);
  const players = snapshot.tournament_players.filter(player => player.status === "approved");
  function opponent(match: StorageRow, teamId: unknown) {
    const opposingId = match.team_a_id === teamId ? match.team_b_id : match.team_a_id;
    if (!opposingId) return "TBD";
    const names = snapshot.team_members.filter(member => member.team_id === opposingId && member.membership_status === "active").map(member => text(member.display_name)).filter(Boolean);
    return names.join(" / ") || text(snapshot.teams.find(team => team.id === opposingId)?.name) || "TBD";
  }
  return <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4 text-brand-500" />Player stats</CardTitle></CardHeader><CardContent className="space-y-3">
    {players.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Stats appear once players join and matches are generated.</p> : players.map(player => {
      const membership = snapshot.team_members.find(member => member.user_id === player.user_id && member.membership_status === "active");
      const teamId = membership?.team_id;
      const rows = snapshot.event?.results_under_review === true ? [] : snapshot.standings.filter(row => teamId && row.team_id === teamId && row.eligible !== false);
      const standing = rows.length === 1 ? rows[0] : undefined;
      const stage = standing && snapshot.stages.find(item => item.id === standing.stage_id);
      const rank = number(standing?.rank), wins = number(standing?.wins), losses = number(standing?.losses);
      const matches = teamId ? currentMatches.filter(match => [match.team_a_id, match.team_b_id].includes(teamId) && pending.has(String(match.status))) : [];
      const scheduled = matches.map(match => ({ match, time: typeof match.scheduled_at === "string" ? Date.parse(match.scheduled_at) : NaN }));
      const sorted = scheduled.every(item => Number.isFinite(item.time)) ? scheduled.sort((a, b) => a.time - b.time) : [];
      const next = matches.length === 1 ? matches[0] : sorted.length > 1 && sorted[0].time < sorted[1].time ? sorted[0].match : undefined;
      const round = next && snapshot.rounds.find(row => row.id === next.round_id);
      const name = text(player.display_name) ?? text(membership?.display_name) ?? "Player";
      const initials = name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
      return <div key={player.id} className="rounded-xl border border-gray-100 p-3"><div className="flex items-start gap-3">
        <Avatar className="h-10 w-10"><AvatarImage src={text(player.avatar_url) ?? ""} /><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2"><p className="font-bold text-gray-900 truncate">{name}</p><Badge variant="secondary">{rank && rank > 0 ? `#${rank}` : "—"}</Badge></div>
          {standing && <p className="mt-1 text-xs text-gray-500">{stage ? `Ranking · ${text(stage.node_id) ?? text(stage.module_id) ?? "stage"}` : "Ranking"}</p>}
          {rows.length > 1 && <p className="mt-1 text-xs text-gray-500">Rankings vary by stage; see Standings.</p>}
          <div className="mt-2 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">{doubles ? "Team W/L" : "W/L"}</p><p className="font-black text-gray-900">{wins !== undefined && losses !== undefined ? `${wins}-${losses}` : "—"}</p></div><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Remaining</p><p className="font-black text-gray-900">{teamId && currentMatches.length ? matches.length : "—"}</p></div><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Next</p><p className="font-black text-gray-900">{number(round?.round_number) !== undefined ? `R${round!.round_number}` : "—"}</p></div></div>
          <p className="mt-2 text-xs text-gray-500 break-words">{next ? `${next.status === "in_progress" ? "Current match" : "Next match"}: ${opponent(next, teamId)}${number(next.court_number) ? ` · Court ${next.court_number}` : ""}` : matches.length > 1 ? "Next match order is not available." : "No known upcoming match."}</p>
        </div></div></div>;
    })}
    {players.length > 0 && <p className="text-xs text-gray-500">Remaining counts known current fixtures; later rounds may not be assigned yet.</p>}
  </CardContent></Card>;
}
