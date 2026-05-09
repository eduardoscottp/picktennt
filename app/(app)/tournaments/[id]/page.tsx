import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, CalendarClock, Clock3, Settings, Share2, Trophy, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MobileHeader } from "@/components/layout/navbar";
import {
  formatDate, getInitials, statusLabel, tournamentTypeLabel,
  generateJoinUrl, duprRatingColor,
} from "@/lib/utils";
import { JoinButton } from "@/components/tournament/join-button";
import { ShareButton } from "@/components/tournament/share-button";
import { ScoreEntryButton } from "@/components/tournament/score-entry-button";
import { PlayersDialog } from "@/components/tournament/players-dialog";
import { DoublesTeamGrid } from "@/components/tournament/doubles-team-grid";
import { TournamentBottomNav, TournamentTopNav } from "@/components/tournament/tournament-bottom-nav";
import { computeIndividualStandingsFromTeams, computeStandings } from "@/lib/tournament/standings";
import type { Match, Profile, Round, Tournament } from "@/types/database";

const ACTIVE_STATUSES = new Set(["active", "finals", "completed"]);

const STAGE_STEPS = [
  { key: "registration", label: "Registration" },
  { key: "active", label: "Matches" },
  { key: "finals", label: "Finals" },
  { key: "completed", label: "Complete" },
];

function stageIndex(status: string) {
  if (status === "draft" || status === "registration") return 0;
  if (status === "active") return 1;
  if (status === "finals") return 2;
  if (status === "completed") return 3;
  return 0;
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function hasPlayerInMatch(match: any, playerId: string, teamIds: Set<string>) {
  return Boolean(
    match.player_a1_id === playerId ||
    match.player_a2_id === playerId ||
    match.player_b1_id === playerId ||
    match.player_b2_id === playerId ||
    (match.team_a_id && teamIds.has(match.team_a_id)) ||
    (match.team_b_id && teamIds.has(match.team_b_id))
  );
}

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tournamentData } = await supabase.from("tournaments").select("*").eq("id", id).single();
  const tournament = tournamentData as Tournament | null;
  if (!tournament) notFound();

  const { data: myPlayerRowData } = user
    ? await supabase.from("tournament_players").select("*").eq("tournament_id", id).eq("user_id", user.id).single()
    : { data: null };
  const myPlayerRow = myPlayerRowData as { status: string; id: string } | null;

  const { data: myAdminRow } = user
    ? await supabase.from("tournament_admins").select("*").eq("tournament_id", id).eq("user_id", user.id).single()
    : { data: null };

  const isAdmin  = !!myAdminRow;
  const isMember = !!myPlayerRow && myPlayerRow.status === "approved";
  const canView  = tournament.is_public || isMember || isAdmin;
  if (!canView) redirect(`/login?redirect=/tournaments/${id}`);

  const { data: playersData } = await supabase
    .from("tournament_players")
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .eq("status", "approved")
    .order("created_at");

  const players = (playersData ?? []) as any[];
  const allPlayerIds = players.map((p: any) => p.user_id as string);

  const joinUrl = generateJoinUrl(tournament.join_code);
  const isActive = ACTIVE_STATUSES.has(tournament.status);
  const isMixed  = tournament.type === "mixed";
  const isDoubles = tournament.type === "doubles";

  // For doubles/singles: fetch teams with member data
  let allTeams: any[] = [];
  let myTeamId: string | null = null;
  let doublesTeams: any[] = [];
  let existingMemberIds: string[] = [];

  if (!isMixed) {
    const { data: teamsRaw } = await supabase
      .from("teams")
      .select("id, name, team_members(user_id, profile:profiles(first_name, last_name, avatar_url))")
      .eq("tournament_id", id)
      .order("created_at");
    allTeams = (teamsRaw ?? []) as any[];

    for (const t of allTeams) {
      if (user && (t.team_members ?? []).some((m: any) => m.user_id === user.id)) {
        myTeamId = t.id as string;
        break;
      }
    }

    existingMemberIds = allTeams.flatMap((t) => (t.team_members ?? []).map((m: any) => m.user_id as string));

    doublesTeams = allTeams.map((t) => ({
      id: t.id as string,
      name: t.name as string | null,
      members: (t.team_members ?? []).map((m: any) => ({
        user_id: m.user_id as string,
        first_name: m.profile?.first_name ?? null,
        last_name: m.profile?.last_name ?? null,
        avatar_url: m.profile?.avatar_url ?? null,
      })),
    }));
  }

  const playerCountLabel = `${players.length} / ${tournament.max_players} players`;
  const tournamentStartLabel = formatShortDateTime((tournament as any).starts_at ?? (tournament as any).start_time ?? null);

  const stageProgress = (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-2">
          {STAGE_STEPS.map((stage, index) => {
            const currentIndex = stageIndex(tournament.status);
            const isCurrent = index === currentIndex;
            const isDone = index < currentIndex;
            return (
              <div key={stage.key} className="flex flex-1 items-center gap-2 last:flex-none">
                <div className="flex flex-col items-center gap-1 min-w-0">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-black ${
                    isCurrent ? "bg-brand-500 text-white shadow-sm" : isDone ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-400"
                  }`}>
                    {index + 1}
                  </div>
                  <span className={`text-[10px] font-semibold truncate ${isCurrent ? "text-brand-600" : "text-gray-400"}`}>{stage.label}</span>
                </div>
                {index < STAGE_STEPS.length - 1 && (
                  <div className={`h-1 flex-1 rounded-full ${isDone ? "bg-brand-300" : "bg-gray-100"}`} />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  // ── Header card (always shown) ──────────────────────────────────────────
  const headerCard = (
    <Card className="overflow-hidden border-brand-100 shadow-sm">
      <div className="h-3 bg-gradient-to-r from-brand-400 to-brand-600" />
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-black text-gray-900 leading-tight">{tournament.name}</h1>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="default" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                {playerCountLabel}
              </Badge>
              <Badge variant="secondary">{tournamentTypeLabel(tournament.type)}</Badge>
              <Badge variant="secondary">{tournament.court_count} courts</Badge>
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-500">
              <p className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                {tournamentStartLabel ? `Starts ${tournamentStartLabel}` : `Created ${formatDate(tournament.created_at)}`}
              </p>
              {!tournamentStartLabel && (
                <p className="flex items-center gap-1.5 text-gray-400">
                  <Clock3 className="h-3.5 w-3.5" />
                  Start date/time is not configured for this tournament.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isActive && (isMember || isAdmin) && (
              <PlayersDialog
                players={players.map((p: any) => ({ id: p.user_id, profile: p.profile as Profile }))}
                maxPlayers={tournament.max_players}
              />
            )}
            {isAdmin && (
              <Link href={`/tournaments/${id}/admin`}>
                <Button variant="outline" size="icon" aria-label="Tournament settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ShareButton joinUrl={joinUrl} joinCode={tournament.join_code} />
          {isAdmin ? (
            <Link href={`/tournaments/${id}/admin`}>
              <Button variant="outline" className="w-full">
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </Link>
          ) : (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 flex items-center justify-center gap-1">
              <Share2 className="h-3.5 w-3.5" />
              Code {tournament.join_code}
            </div>
          )}
        </div>

        {user && !isMember && !isAdmin && (
          <div className="mt-3">
            <JoinButton
              tournamentId={id}
              userId={user.id}
              pendingRowId={myPlayerRow?.status === "pending" ? myPlayerRow.id : undefined}
            />
          </div>
        )}
        {!user && (
          <Link href={`/login?redirect=/tournaments/${id}`} className="block mt-3">
            <Button className="w-full">Sign in to Join</Button>
          </Link>
        )}
      </CardContent>
    </Card>
  );

  // ── ACTIVE / FINALS / COMPLETED: show matches as main content ───────────
  if (isActive && (isMember || isAdmin)) {
    const { data: rounds } = await supabase
      .from("rounds")
      .select("*")
      .eq("tournament_id", id)
      .order("round_number");

    const { data: matchesRaw } = await supabase
      .from("matches")
      .select(`
        *,
        team_a:teams!matches_team_a_id_fkey(id, name, team_members(user_id, profile:profiles(*))),
        team_b:teams!matches_team_b_id_fkey(id, name, team_members(user_id, profile:profiles(*))),
        player_a1:profiles!matches_player_a1_id_fkey(*),
        player_a2:profiles!matches_player_a2_id_fkey(*),
        player_b1:profiles!matches_player_b1_id_fkey(*),
        player_b2:profiles!matches_player_b2_id_fkey(*)
      `)
      .eq("tournament_id", id)
      .order("court_number");

    const matches = (matchesRaw ?? []) as any[];

    // Group matches by round
    const matchesByRound = new Map<string, any[]>();
    for (const m of matches) {
      const arr = matchesByRound.get(m.round_id) ?? [];
      arr.push(m);
      matchesByRound.set(m.round_id, arr);
    }

    // Compute sitting-out players per round
    function getSittingOut(roundMatches: any[]): string[] {
      const playing = new Set<string>();
      for (const m of roundMatches) {
        if (isMixed) {
          [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id]
            .filter(Boolean).forEach((id: string) => playing.add(id));
        } else {
          (m.team_a?.team_members ?? []).forEach((tm: any) => playing.add(tm.user_id));
          (m.team_b?.team_members ?? []).forEach((tm: any) => playing.add(tm.user_id));
        }
      }
      return allPlayerIds.filter((pid) => !playing.has(pid));
    }

    // Player lookup map
    const playerMap = new Map<string, Profile>();
    for (const p of players) playerMap.set(p.user_id, p.profile as Profile);

    const statusBadge = (s: string) => {
      const v = { scheduled: "secondary", in_progress: "default", score_entered: "warning", validated: "success", disputed: "danger" }[s] ?? "secondary";
      return <Badge variant={v as any} className="text-[10px] shrink-0">{statusLabel(s)}</Badge>;
    };

    function PlayerChip({ profile }: { profile: Profile }) {
      return (
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar className="h-6 w-6 flex-shrink-0">
            <AvatarImage src={profile.avatar_url ?? ""} />
            <AvatarFallback className="text-[10px]">{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-semibold text-gray-900 leading-tight break-words min-w-0">
            {profile.first_name} {profile.last_name}
          </span>
          {profile.dupr_rating && (
            <span className={`text-[10px] font-bold flex-shrink-0 ${duprRatingColor(profile.dupr_rating)}`}>
              {profile.dupr_rating.toFixed(1)}
            </span>
          )}
        </div>
      );
    }

    function TeamDisplay({ match, side }: { match: any; side: "a" | "b" }) {
      if (isMixed) {
        const p1: Profile | undefined = side === "a" ? match.player_a1 : match.player_b1;
        const p2: Profile | undefined = side === "a" ? match.player_a2 : match.player_b2;
        return (
          <div className="flex flex-col gap-1">
            {p1 && <PlayerChip profile={p1} />}
            {p2 && <PlayerChip profile={p2} />}
          </div>
        );
      }
      const team = side === "a" ? match.team_a : match.team_b;
      if (!team) return <span className="text-xs text-gray-400">TBD</span>;
      return (
        <div className="flex flex-col gap-1">
          {(team.team_members ?? []).map((tm: any) => (
            <PlayerChip key={tm.user_id} profile={tm.profile} />
          ))}
        </div>
      );
    }

    const teamToMembers = new Map<string, string[]>();
    const playerToTeams = new Map<string, Set<string>>();
    for (const team of allTeams) {
      const memberIds = (team.team_members ?? []).map((tm: any) => tm.user_id as string);
      teamToMembers.set(team.id as string, memberIds);
      for (const memberId of memberIds) {
        if (!playerToTeams.has(memberId)) playerToTeams.set(memberId, new Set());
        playerToTeams.get(memberId)!.add(team.id as string);
      }
    }

    const standings = isMixed
      ? computeStandings(matches as Match[], "player")
      : computeIndividualStandingsFromTeams(matches as Match[], teamToMembers);
    const standingsByPlayer = new Map(standings.map((row) => [row.id, row]));
    const roundById = new Map((rounds ?? []).map((round: Round) => [round.id, round]));
    const playerStats = players.map((player: any) => {
      const teamIds = playerToTeams.get(player.user_id as string) ?? new Set<string>();
      const playerMatches = matches.filter((match) => hasPlayerInMatch(match, player.user_id as string, teamIds));
      const remainingMatches = playerMatches.filter((match) => match.status !== "validated");
      const nextMatch = remainingMatches
        .slice()
        .sort((a, b) => {
          const roundA = roundById.get(a.round_id)?.round_number ?? 999;
          const roundB = roundById.get(b.round_id)?.round_number ?? 999;
          return roundA === roundB ? (a.court_number ?? 999) - (b.court_number ?? 999) : roundA - roundB;
        })[0];
      return {
        player,
        standing: standingsByPlayer.get(player.user_id as string),
        remainingMatches: remainingMatches.length,
        nextMatch,
      };
    }).sort((a, b) => (a.standing?.rank ?? 999) - (b.standing?.rank ?? 999));

    function opponentLabel(match: any, playerId: string) {
      if (!match) return "No scheduled match";
      const teamIds = playerToTeams.get(playerId) ?? new Set<string>();
      const isSideA = match.player_a1_id === playerId || match.player_a2_id === playerId || (match.team_a_id && teamIds.has(match.team_a_id));
      const opposingTeam = isSideA ? match.team_b : match.team_a;
      if (isMixed) {
        const profiles = isSideA ? [match.player_b1, match.player_b2] : [match.player_a1, match.player_a2];
        return profiles.filter(Boolean).map((profile: Profile) => `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim()).join(" / ") || "TBD";
      }
      return (opposingTeam?.team_members ?? [])
        .map((tm: any) => `${tm.profile?.first_name ?? ""} ${tm.profile?.last_name ?? ""}`.trim())
        .filter(Boolean)
        .join(" / ") || "TBD";
    }

    const playerStatsSection = (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-brand-500" />
            Player stats
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {playerStats.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Stats appear once players join and matches are generated.</p>
          ) : (
            playerStats.map(({ player, standing, remainingMatches, nextMatch }) => {
              const profile = player.profile as Profile;
              const round = nextMatch ? roundById.get(nextMatch.round_id) : null;
              return (
                <div key={player.user_id} className="rounded-xl border border-gray-100 p-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={profile.avatar_url ?? ""} />
                      <AvatarFallback>{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-gray-900 truncate">{profile.first_name} {profile.last_name}</p>
                        <Badge variant="secondary">#{standing?.rank ?? "—"}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-gray-50 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">W/L</p>
                          <p className="font-black text-gray-900">{standing?.wins ?? 0}-{standing?.losses ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Remaining</p>
                          <p className="font-black text-gray-900">{remainingMatches}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Next</p>
                          <p className="font-black text-gray-900">{round ? `R${round.round_number}` : "—"}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-gray-500">
                        {nextMatch ? `Next match: ${opponentLabel(nextMatch, player.user_id)}${nextMatch.court_number ? ` · Court ${nextMatch.court_number}` : ""}` : "No upcoming match scheduled."}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    );

    return (
      <div className="max-w-2xl mx-auto">
        <MobileHeader title={tournament.name} back="/tournaments" />
        <div className="px-4 py-4 pb-32 space-y-4">
          <TournamentTopNav tournamentId={id} isAdmin={isAdmin} />
          {headerCard}
          {stageProgress}

          {/* Team grid for doubles: show slot picker if player has no team yet */}
          {isDoubles && isMember && !myTeamId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-brand-500" />
                  Choose Your Team Slot
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DoublesTeamGrid
                  tournamentId={id}
                  teams={doublesTeams}
                  isAdmin={isAdmin}
                  currentUserId={user!.id}
                  myTeamId={null}
                  isApprovedPlayer={true}
                  existingMemberIds={existingMemberIds}
                />
              </CardContent>
            </Card>
          )}

          {playerStatsSection}

          {tournament.rules_text && (
            <Link href="#rules" className="block">
              <Button variant="secondary" size="sm" className="w-full">
                <BookOpen className="h-4 w-4" />
                View rules
              </Button>
            </Link>
          )}

          {/* Rounds + matches */}
          {(rounds ?? []).length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Trophy className="h-10 w-10 mx-auto mb-3 text-gray-200" />
              <p className="font-semibold">No rounds yet</p>
              <p className="text-sm mt-1">
                {isAdmin ? "Generate the first round from the admin panel." : "The admin will generate matches soon."}
              </p>
            </div>
          ) : (
            (rounds ?? []).map((round: Round) => {
              const roundMatches = matchesByRound.get(round.id) ?? [];
              const sittingOutIds = getSittingOut(roundMatches);

              return (
                <div key={round.id} className="space-y-3">
                  {/* Round header */}
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-gray-900">
                      Round {round.round_number}
                      <span className="text-brand-500 font-medium ml-1 capitalize text-sm">
                        · {round.round_type.replace(/_/g, " ")}
                      </span>
                    </h2>
                    <Badge variant={round.status === "completed" ? "success" : round.status === "active" ? "default" : "secondary"}>
                      {round.status}
                    </Badge>
                  </div>

                  {/* Match cards */}
                  {roundMatches.map((match: any) => (
                    <Card key={match.id} className="overflow-hidden">
                      <CardContent className="p-0">
                        {/* Court + status bar */}
                        <div className="bg-brand-500 text-white text-xs font-bold px-3 py-1.5 flex items-center justify-between">
                          <span>Court {match.court_number ?? "?"}</span>
                          {statusBadge(match.status)}
                        </div>

                        <div className="p-3">
                          {/* Mobile: names stay left, score stays visible right */}
                          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3 md:hidden">
                            <div className="min-w-0 space-y-3">
                              <TeamDisplay match={match} side="a" />
                              <TeamDisplay match={match} side="b" />
                            </div>
                            <div className="flex flex-col items-end justify-center gap-3 border-l border-gray-100 pl-3">
                              <div className={`text-2xl font-black w-10 text-center tabular-nums ${
                                match.score_a != null && match.score_b != null
                                  ? match.score_a > match.score_b ? "text-brand-500" : "text-gray-400"
                                  : "text-gray-300"
                              }`}>{match.score_a ?? "–"}</div>
                              <div className={`text-2xl font-black w-10 text-center tabular-nums ${
                                match.score_a != null && match.score_b != null
                                  ? match.score_b > match.score_a ? "text-brand-500" : "text-gray-400"
                                  : "text-gray-300"
                              }`}>{match.score_b ?? "–"}</div>
                            </div>
                          </div>

                          {/* Tablet/desktop: keep side-by-side layout */}
                          <div className="hidden md:flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <TeamDisplay match={match} side="a" />
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <div className={`text-2xl font-black w-8 text-center tabular-nums ${
                                match.score_a != null && match.score_b != null
                                  ? match.score_a > match.score_b ? "text-brand-500" : "text-gray-400"
                                  : "text-gray-300"
                              }`}>{match.score_a ?? "–"}</div>
                              <div className="text-gray-300 text-sm font-bold">:</div>
                              <div className={`text-2xl font-black w-8 text-center tabular-nums ${
                                match.score_a != null && match.score_b != null
                                  ? match.score_b > match.score_a ? "text-brand-500" : "text-gray-400"
                                  : "text-gray-300"
                              }`}>{match.score_b ?? "–"}</div>
                            </div>

                            <div className="flex-1 min-w-0 flex justify-end">
                              <TeamDisplay match={match} side="b" />
                            </div>
                          </div>

                          {/* Score entry / validation / admin edit */}
                          <ScoreEntryButton
                            match={match}
                            userId={user!.id}
                            isAdmin={isAdmin}
                            isMixed={isMixed}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Sitting out */}
                  {sittingOutIds.length > 0 && (
                    <Card className="border-dashed border-amber-200 bg-amber-50/50">
                      <CardContent className="py-3 px-4">
                        <p className="text-xs font-semibold text-amber-700 mb-2">
                          Sitting out this round ({sittingOutIds.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {sittingOutIds.map((pid) => {
                            const profile = playerMap.get(pid);
                            if (!profile) return null;
                            return (
                              <div key={pid} className="flex items-center gap-1.5 bg-white rounded-full px-2.5 py-1 border border-amber-200">
                                <Avatar className="h-5 w-5">
                                  <AvatarImage src={profile.avatar_url ?? ""} />
                                  <AvatarFallback className="text-[9px]">{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                                </Avatar>
                                <span className="text-xs font-medium text-gray-700">
                                  {profile.first_name} {profile.last_name}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              );
            })
          )}

          {/* Rules (anchored section at bottom) */}
          {tournament.rules_text && (
            <Card id="rules">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4 text-brand-500" />
                  Tournament Rules
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{tournament.rules_text}</p>
              </CardContent>
            </Card>
          )}
        </div>
        <TournamentBottomNav tournamentId={id} isAdmin={isAdmin} />
      </div>
    );
  }

  // ── REGISTRATION / DRAFT: show player list + join ───────────────────────
  const { data: admins } = await supabase
    .from("tournament_admins")
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .order("succession_order");

  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title={tournament.name} back="/tournaments" />
      <div className="px-4 py-4 pb-32 space-y-4">
        <TournamentTopNav tournamentId={id} isAdmin={isAdmin} />
        {headerCard}
        {stageProgress}

        {tournament.rules_text && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4 text-brand-500" />
                Tournament Rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{tournament.rules_text}</p>
            </CardContent>
          </Card>
        )}

        {/* Doubles: visual team slot grid */}
        {isDoubles && doublesTeams.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-brand-500" />
                  Teams ({doublesTeams.length})
                </span>
                <span className="text-xs font-normal text-gray-400">
                  {doublesTeams.filter((t) => t.members.length === 2).length} / {doublesTeams.length} complete
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DoublesTeamGrid
                tournamentId={id}
                teams={doublesTeams}
                isAdmin={isAdmin}
                currentUserId={user?.id ?? null}
                myTeamId={myTeamId}
                isApprovedPlayer={isMember}
                existingMemberIds={existingMemberIds}
                readonly={!isMember && !isAdmin}
              />
            </CardContent>
          </Card>
        )}

        {/* Singles / mixed: player list */}
        {!isDoubles ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-brand-500" />
                Players ({players.length} / {tournament.max_players})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {players.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No players yet</p>
              ) : (
                players.map((p: any) => {
                  const profile = p.profile as Profile;
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={profile.avatar_url ?? ""} />
                        <AvatarFallback>{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 text-sm">{profile.first_name} {profile.last_name}</div>
                      </div>
                      {profile.dupr_rating && (
                        <span className={`text-xs font-bold ${duprRatingColor(profile.dupr_rating)}`}>
                          {profile.dupr_rating.toFixed(2)}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <TournamentBottomNav tournamentId={id} isAdmin={isAdmin} />
    </div>
  );
}
