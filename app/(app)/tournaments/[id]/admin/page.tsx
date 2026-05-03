import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { MobileHeader } from "@/components/layout/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials, formatDate, generateJoinUrl, statusLabel } from "@/lib/utils";
import { AdminPlayerActions } from "@/components/tournament/admin-player-actions";
import { AdminStatusActions } from "@/components/tournament/admin-status-actions";
import { AdminGenerateRound } from "@/components/tournament/admin-generate-round";
import { AdminBracketActions } from "@/components/tournament/admin-bracket-actions";
import { AdminAddPlayer } from "@/components/tournament/admin-add-player";
import { ShareButton } from "@/components/tournament/share-button";
import type { Profile, Tournament, Match } from "@/types/database";

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
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .eq("status", "approved");

  // Admins
  const { data: admins } = await supabase
    .from("tournament_admins")
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .order("succession_order");

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
  const hasBracketAlready = allMatches.some((m) => m.bracket_next_winner_match_id !== null);
  const showBracketButton = rrAllValidated && !hasBracketAlready && !!tournament.advancement_count;

  const joinUrl = generateJoinUrl(tournament.join_code);

  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title="Admin Panel" back={`/tournaments/${id}`} />
      <div className="px-4 py-6 space-y-5">

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
            <AdminStatusActions tournament={tournament} />
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>Join code:</span>
              <span className="font-mono font-bold text-brand-600">{tournament.join_code}</span>
              <ShareButton joinUrl={joinUrl} joinCode={tournament.join_code} />
            </div>
          </CardContent>
        </Card>

        {/* Bracket generation — shown when all RR matches are validated */}
        {showBracketButton && (
          <AdminBracketActions
            tournament={tournament}
            matches={allMatches}
            advancingCount={tournament.advancement_count!}
          />
        )}

        {/* Manual schedule generator */}
        {(tournament.status === "active" || tournament.status === "registration") && (
          <AdminGenerateRound tournament={tournament} playerCount={(approvedPlayers ?? []).length} />
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

        {/* Add player by search */}
        <AdminAddPlayer
          tournament={tournament}
          existingPlayerIds={(approvedPlayers ?? []).map((p: any) => p.user_id)}
        />

        {/* Approved players */}
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
                    <AdminPlayerActions tournamentPlayerId={p.id} status="approved" />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Admin succession */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Administrators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(admins ?? []).map((a: any, idx: number) => {
              const profile = a.profile as Profile;
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <div className="w-6 text-xs font-bold text-gray-400">#{a.succession_order}</div>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={profile?.avatar_url ?? ""} />
                    <AvatarFallback className="text-xs">{getInitials(profile?.first_name, profile?.last_name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-sm font-medium text-gray-900">
                    {profile?.first_name} {profile?.last_name}
                    {idx === 0 && <span className="ml-2 text-xs text-brand-500">Primary</span>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
