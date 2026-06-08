import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { MobileHeader } from "@/components/layout/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users } from "lucide-react";
import { getInitials, generateJoinUrl, statusLabel } from "@/lib/utils";
import { AdminPlayerActions } from "@/components/tournament/admin-player-actions";
import { AdminStatusActions } from "@/components/tournament/admin-status-actions";
import { AdminGenerateRound } from "@/components/tournament/admin-generate-round";
import { AdminAddPlayer } from "@/components/tournament/admin-add-player";
import { AdminUploadDupr } from "@/components/tournament/admin-upload-dupr";
import { AdminTournamentInfo } from "@/components/tournament/admin-tournament-info";
import { DoublesTeamGrid } from "@/components/tournament/doubles-team-grid";
import { ShareButton } from "@/components/tournament/share-button";
import { TournamentBottomNav, TournamentTopNav } from "@/components/tournament/tournament-bottom-nav";
import { AdminManageAdmins } from "@/components/tournament/admin-manage-admins";
import type { Profile, Tournament, TournamentAdmin, Match } from "@/types/database";

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tournamentData } = await supabase
    .from("tournaments").select("*").eq("id", id).single();
  if (!tournamentData) notFound();
  const tournament = tournamentData as Tournament;

  // Must be admin
  const { data: adminRow } = await supabase
    .from("tournament_admins").select("*").eq("tournament_id", id).eq("user_id", user.id).single();
  if (!adminRow) redirect(`/tournaments/${id}`);

  // Pending players
  const { data: pendingPlayers } = await supabase
    .from("tournament_players")
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .eq("status", "pending");

  // Approved players
  const { data: approvedPlayers } = await supabase
    .from("tournament_players")
    .select("*, nullified_from_standings, profile:profiles(*)")
    .eq("tournament_id", id)
    .eq("status", "approved");

  // Admins
  const { data: admins } = await supabase
    .from("tournament_admins")
    .select("*, profile:profiles!tournament_admins_user_id_fkey(*)")
    .eq("tournament_id", id)
    .order("succession_order");

  // For doubles/singles: fetch teams with members
  const { data: teamsRaw } = tournament.type !== "mixed"
    ? await supabase
        .from("teams")
        .select("id, name, team_members(user_id, profile:profiles(first_name, last_name, avatar_url))")
        .eq("tournament_id", id)
        .order("created_at")
    : { data: null };
  const teams = (teamsRaw ?? []) as any[];
  const teamsData = teams.map((t) => ({ id: t.id as string, memberCount: (t.team_members ?? []).length as number }));

  // For doubles grid: compute who's already slotted and which team the admin is in
  const existingMemberIds: string[] = teams.flatMap((t) => (t.team_members ?? []).map((m: any) => m.user_id as string));
  let adminTeamId: string | null = null;
  for (const t of teams) {
    if ((t.team_members ?? []).some((m: any) => m.user_id === user.id)) {
      adminTeamId = t.id as string;
      break;
    }
  }
  const doublesTeams = teams.map((t) => ({
    id: t.id as string,
    name: t.name as string | null,
    members: (t.team_members ?? []).map((m: any) => ({
      user_id: m.user_id as string,
      first_name: m.profile?.first_name ?? null,
      last_name: m.profile?.last_name ?? null,
      avatar_url: m.profile?.avatar_url ?? null,
    })),
  }));

  // Fetch rounds to know if a schedule already exists
  const { data: roundsRaw } = await supabase
    .from("rounds")
    .select("id, round_type")
    .eq("tournament_id", id);
  const hasExistingRounds = (roundsRaw ?? []).length > 0;

  // Fetch matches to determine if RR is complete
  const { data: allMatchesRaw } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", id);
  const allMatches = (allMatchesRaw ?? []) as Match[];

  const rrMatches = allMatches.filter(
    (m) => m.bracket_next_winner_match_id === null && m.bracket_next_loser_match_id === null
      && m.bracket_winner_fills_side === null
  );
  const rrAllValidated = rrMatches.length > 0 && rrMatches.every((m) => m.status === "validated");
  const bracketRoundTypes = new Set(["elimination", "finals_gold", "finals_bronze"]);
  const hasBracketAlready = (roundsRaw ?? []).some((r: any) => bracketRoundTypes.has(r.round_type));
  const allMatchesValidated = allMatches.length > 0 && allMatches.every((m) => m.status === "validated");

  const joinUrl = generateJoinUrl(tournament.join_code);
  const currentUserPlayer = (approvedPlayers ?? []).find((p: any) => p.user_id === user.id);

  // ── Removal context ────────────────────────────────────────────────────────

  // Does any match in this tournament have a score?
  const { count: scoredMatchCount } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournament.id)
    .in("status", ["score_entered", "validated", "in_progress"]);

  const anyTournamentScores = (scoredMatchCount ?? 0) > 0;

  // Fetch all scored matches (for per-player games-played count)
  const { data: scoredMatches } = await supabase
    .from("matches")
    .select("id, status, player_a1_id, player_a2_id, player_b1_id, player_b2_id, team_a_id, team_b_id")
    .eq("tournament_id", tournament.id)
    .in("status", ["score_entered", "validated", "in_progress"]);

  // Fetch team_members to map player → team for doubles/singles
  const { data: allTeamMembers } = await supabase
    .from("team_members")
    .select("user_id, team_id");

  const playerToTeamId = new Map<string, string>();
  for (const tm of allTeamMembers ?? []) {
    playerToTeamId.set(tm.user_id, tm.team_id);
  }

  function gamesPlayedForPlayer(userId: string): number {
    const teamId = playerToTeamId.get(userId);
    return (scoredMatches ?? []).filter((m) => {
      if ([m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id].includes(userId)) return true;
      if (teamId && (m.team_a_id === teamId || m.team_b_id === teamId)) return true;
      return false;
    }).length;
  }

  function inProgressMatchForPlayer(userId: string): string | null {
    const teamId = playerToTeamId.get(userId);
    const found = (scoredMatches ?? []).find(
      (m) =>
        m.status === "in_progress" &&
        (
          [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id].includes(userId) ||
          (teamId && (m.team_a_id === teamId || m.team_b_id === teamId))
        )
    );
    return found?.id ?? null;
  }

  function removalPath(userId: string): "A" | "B" | "C" {
    if (!hasExistingRounds) return "A";
    if (gamesPlayedForPlayer(userId) > 0) return "C";
    return "B";
  }

  // Nullified entity IDs for standings (players with nullified_from_standings = true)
  const nullifiedPlayers = (approvedPlayers ?? []).filter(
    (p: any) => p.nullified_from_standings === true
  );
  const nullifiedUserIds = new Set(nullifiedPlayers.map((p: any) => p.user_id as string));

  const nullifiedTeamIds = new Set<string>();
  for (const userId of nullifiedUserIds) {
    const teamId = playerToTeamId.get(userId);
    if (teamId) nullifiedTeamIds.add(teamId);
  }

  const nullifiedEntityIds = tournament.type === "mixed"
    ? Array.from(nullifiedUserIds)
    : Array.from(nullifiedTeamIds);

  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title="Admin Panel" back={`/tournaments/${id}`} />
      <div className="px-4 py-6 pb-32 space-y-5">
        <TournamentTopNav tournamentId={id} isAdmin={true} />

        {/* Status + actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Tournament Status</span>
              <Badge variant={tournament.status === "active" ? "success" : "secondary"}>
                {statusLabel(tournament.status)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AdminStatusActions tournament={tournament} hasExistingRounds={hasExistingRounds} allMatchesValidated={allMatchesValidated} />
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>Join code:</span>
              <span className="font-mono font-bold text-brand-600">{tournament.join_code}</span>
              <ShareButton joinUrl={joinUrl} joinCode={tournament.join_code} />
            </div>
          </CardContent>
        </Card>

        {/* Tournament info — date, venue, address — editable anytime */}
        <AdminTournamentInfo tournament={tournament} />

        {/* DUPR upload — only shown for completed tournaments */}
        {tournament.status === "completed" && (
          <AdminUploadDupr tournamentId={id} />
        )}

        {/* Schedule card — handles RR generation, validation, and bracket phase */}
        {tournament.status !== "draft" && tournament.status !== "completed" && (
          <AdminGenerateRound
            tournament={tournament}
            playerCount={(approvedPlayers ?? []).length}
            teamsData={tournament.type !== "mixed" ? teamsData : undefined}
            currentUserId={user.id}
            isCurrentUserPlayer={!!currentUserPlayer}
            currentUserTeamId={adminTeamId}
            hasExistingRounds={hasExistingRounds}
            rrMatches={rrMatches}
            rrAllValidated={rrAllValidated}
            hasBracketAlready={hasBracketAlready}
            advancingCount={tournament.advancement_count ?? null}
            nullifiedEntityIds={nullifiedEntityIds}
          />
        )}

        {/* Pending players */}
        {(pendingPlayers ?? []).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Pending Requests ({(pendingPlayers ?? []).length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(pendingPlayers ?? []).map((p: any) => {
                const profile = p.profile as Profile;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={profile.avatar_url ?? ""} />
                      <AvatarFallback>{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">
                        {profile.first_name} {profile.last_name}
                      </div>
                      <div className="text-xs text-gray-400">{profile.email}</div>
                    </div>
                    <AdminPlayerActions tournamentPlayerId={p.id} status="pending" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Doubles: unassigned players (approved but no team yet) */}
        {tournament.type === "doubles" && (() => {
          const existingSet = new Set(existingMemberIds);
          const unassigned = (approvedPlayers ?? []).filter((p: any) => !existingSet.has(p.user_id));
          if (unassigned.length === 0) return null;
          return (
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2 text-amber-700">
                    <Users className="h-4 w-4" />
                    Unassigned Players ({unassigned.length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-gray-400">Approved players not yet assigned to a team. Drag them into a slot above or remove from tournament.</p>
                {unassigned.map((p: any) => {
                  const profile = p.profile as Profile;
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={profile.avatar_url ?? ""} />
                        <AvatarFallback>{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900">
                          {profile.first_name} {profile.last_name}
                        </div>
                        <div className="text-xs text-gray-400">{profile.email}</div>
                      </div>
                      <AdminPlayerActions
                        tournamentPlayerId={p.id}
                        tournamentId={tournament.id}
                        playerName={`${profile.first_name} ${profile.last_name}`}
                        status="approved"
                        removalPath={removalPath(p.user_id)}
                        anyTournamentScores={anyTournamentScores}
                        gamesPlayed={gamesPlayedForPlayer(p.user_id)}
                        inProgressMatchId={inProgressMatchForPlayer(p.user_id)}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })()}

        {/* Doubles: visual team slot grid */}
        {tournament.type === "doubles" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Teams ({doublesTeams.length})</span>
                <span className="text-xs font-normal text-gray-400">
                  {doublesTeams.filter((t) => t.members.length === 2).length} / {doublesTeams.length} complete
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DoublesTeamGrid
                tournamentId={id}
                teams={doublesTeams}
                isAdmin={true}
                currentUserId={user.id}
                myTeamId={adminTeamId}
                isApprovedPlayer={true}
                existingMemberIds={existingMemberIds}
              />
            </CardContent>
          </Card>
        )}

        {/* Singles / mixed: classic add-player search + approved list */}
        {tournament.type !== "doubles" && (
          <>
            <AdminAddPlayer
              tournament={tournament}
              existingPlayerIds={(approvedPlayers ?? []).map((p: any) => p.user_id)}
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Players ({(approvedPlayers ?? []).length} / {tournament.max_players})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(approvedPlayers ?? []).length === 0 ? (
                  <p className="text-sm text-gray-400">No approved players yet</p>
                ) : (
                  (approvedPlayers ?? []).map((p: any) => {
                    const profile = p.profile as Profile;
                    return (
                      <div key={p.id} className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={profile.avatar_url ?? ""} />
                          <AvatarFallback>{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-gray-900">
                            {profile.first_name} {profile.last_name}
                          </div>
                          <div className="text-xs text-gray-400">{profile.email}</div>
                        </div>
                        <AdminPlayerActions
                          tournamentPlayerId={p.id}
                          tournamentId={tournament.id}
                          playerName={`${profile.first_name} ${profile.last_name}`}
                          status="approved"
                          removalPath={removalPath(p.user_id)}
                          anyTournamentScores={anyTournamentScores}
                          gamesPlayed={gamesPlayedForPlayer(p.user_id)}
                          inProgressMatchId={inProgressMatchForPlayer(p.user_id)}
                        />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Admin management */}
        <AdminManageAdmins
          tournamentId={id}
          admins={(admins ?? []) as (TournamentAdmin & { profile: Profile })[]}
          currentUserId={user.id}
        />
      </div>
      <TournamentBottomNav tournamentId={id} isAdmin />
    </div>
  );
}
