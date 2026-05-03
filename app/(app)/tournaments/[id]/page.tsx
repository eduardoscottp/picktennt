import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Settings, Users, Trophy, BarChart3 } from "lucide-react";
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
import { TeamPicker } from "@/components/tournament/team-picker";
import type { AvailableTeam } from "@/components/tournament/team-picker";
import type { Tournament, TournamentPlayer, Profile, Round } from "@/types/database";

const ACTIVE_STATUSES = new Set(["active", "finals", "completed"]);

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

  // For doubles/singles: fetch teams to determine team membership and available slots
  let allTeams: any[] = [];
  let myTeamId: string | null = null;
  let availableTeamSlots: AvailableTeam[] = [];

  if (!isMixed && user) {
    const { data: teamsRaw } = await supabase
      .from("teams")
      .select("id, name, team_members(user_id, profile:profiles(first_name, last_name, avatar_url))")
      .eq("tournament_id", id)
      .order("created_at");
    allTeams = (teamsRaw ?? []) as any[];

    for (const t of allTeams) {
      if ((t.team_members ?? []).some((m: any) => m.user_id === user.id)) {
        myTeamId = t.id as string;
        break;
      }
    }

    // Slots available for team picking (teams with < 2 members, excluding user's own team if exists)
    availableTeamSlots = allTeams
      .filter((t) => (t.team_members ?? []).length < 2 && t.id !== myTeamId)
      .map((t) => ({
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

  const statusColor = {
    draft: "secondary", registration: "default",
    active: "success", finals: "warning", completed: "secondary",
  }[tournament.status] ?? "secondary";

  // ── Header card (always shown) ──────────────────────────────────────────
  const headerCard = (
    <Card className="overflow-hidden">
      <div className="h-3 bg-gradient-to-r from-brand-400 to-brand-600" />
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-gray-900 leading-tight">{tournament.name}</h1>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant={statusColor as any}>{statusLabel(tournament.status)}</Badge>
              <Badge variant="secondary">{tournamentTypeLabel(tournament.type)}</Badge>
              <Badge variant="secondary">{tournament.court_count} courts</Badge>
            </div>
            <p className="text-xs text-gray-400 mt-1">Created {formatDate(tournament.created_at)}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isActive && (isMember || isAdmin) && (
              <PlayersDialog
                players={players.map((p: any) => ({ id: p.user_id, profile: p.profile as Profile }))}
                maxPlayers={tournament.max_players}
              />
            )}
            <ShareButton joinUrl={joinUrl} joinCode={tournament.join_code} />
            {isAdmin && (
              <Link href={`/tournaments/${id}/admin`}>
                <Button variant="outline" size="icon">
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
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
          <span className="text-sm font-semibold text-gray-900 truncate">
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

    return (
      <div className="max-w-2xl mx-auto">
        <MobileHeader title={tournament.name} back="/tournaments" />
        <div className="px-4 py-4 space-y-4">
          {headerCard}

          {/* Team picker for doubles: approved but no team yet */}
          {isDoubles && isMember && !myTeamId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-brand-500" />
                  Choose Your Team
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TeamPicker
                  tournamentId={id}
                  userId={user!.id}
                  availableTeams={availableTeamSlots}
                />
              </CardContent>
            </Card>
          )}

          {/* Navigation strip */}
          <div className="flex gap-2">
            <Link href={`/tournaments/${id}/leaderboard`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                <BarChart3 className="h-4 w-4" />
                Standings
              </Button>
            </Link>
            {tournament.rules_text && (
              <Link href="#rules" className="flex-1">
                <Button variant="secondary" size="sm" className="w-full">
                  <BookOpen className="h-4 w-4" />
                  Rules
                </Button>
              </Link>
            )}
          </div>

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
                          {/* Players + Score */}
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <TeamDisplay match={match} side="a" />
                            </div>

                            {/* Score */}
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
      <div className="px-4 py-4 space-y-4">
        {headerCard}

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

        {/* Team picker for doubles: approved but no team yet */}
        {isDoubles && isMember && !myTeamId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-brand-500" />
                Choose Your Team
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TeamPicker
                tournamentId={id}
                userId={user!.id}
                availableTeams={availableTeamSlots}
              />
            </CardContent>
          </Card>
        )}

        {/* Teams list for doubles/singles */}
        {!isMixed && allTeams.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-brand-500" />
                Teams ({allTeams.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {allTeams.map((team: any) => {
                const members: any[] = team.team_members ?? [];
                const isComplete = !isDoubles || members.length === 2;
                return (
                  <div
                    key={team.id}
                    className={`rounded-xl border px-3 py-2.5 ${isComplete ? "border-gray-100 bg-gray-50" : "border-amber-200 bg-amber-50"}`}
                  >
                    {isDoubles && !isComplete && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 mb-1 inline-block">
                        Needs partner
                      </span>
                    )}
                    <div className="space-y-1 mt-0.5">
                      {members.map((m: any) => {
                        const p = m.profile as Profile;
                        return (
                          <div key={m.user_id} className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={p?.avatar_url ?? ""} />
                              <AvatarFallback className="text-[9px]">{getInitials(p?.first_name, p?.last_name)}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium text-gray-900">{p?.first_name} {p?.last_name}</span>
                            {p?.dupr_rating && (
                              <span className={`text-xs font-bold ml-auto ${duprRatingColor(p.dupr_rating)}`}>
                                {p.dupr_rating.toFixed(2)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : isMixed ? (
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
    </div>
  );
}
