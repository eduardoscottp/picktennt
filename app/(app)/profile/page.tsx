import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MobileHeader } from "@/components/layout/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EditProfileForm } from "@/components/auth/edit-profile-form";
import { getInitials, duprRatingColor, statusLabel, tournamentTypeLabel, formatDate } from "@/lib/utils";
import { Trophy, TrendingUp, Target, Calendar } from "lucide-react";
import type { Profile, Tournament, Match } from "@/types/database";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileData } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  const profile = profileData as Profile | null;

  // All tournaments the user has played in
  const { data: playerRows } = await supabase
    .from("tournament_players")
    .select("*, tournament:tournaments(*)")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  // All matches (validated) the user participated in
  const { data: mixedMatches } = await supabase
    .from("matches")
    .select("*, round:rounds(round_number, round_type)")
    .eq("status", "validated")
    .or(`player_a1_id.eq.${user.id},player_a2_id.eq.${user.id},player_b1_id.eq.${user.id},player_b2_id.eq.${user.id}`)
    .order("updated_at", { ascending: false })
    .limit(20);

  const { data: teamRows } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id);

  const teamIds = (teamRows ?? []).map((t: any) => t.team_id);
  let teamMatches: any[] = [];
  if (teamIds.length > 0) {
    const { data } = await supabase
      .from("matches")
      .select("*, round:rounds(round_number, round_type)")
      .eq("status", "validated")
      .or(`team_a_id.in.(${teamIds.join(",")}),team_b_id.in.(${teamIds.join(",")})`)
      .order("updated_at", { ascending: false })
      .limit(20);
    teamMatches = data ?? [];
  }

  const allMatches = [...(mixedMatches ?? []), ...teamMatches];

  // Compute stats
  let wins = 0, losses = 0, pf = 0, pa = 0;
  for (const m of allMatches) {
    const isSideA = m.player_a1_id === user.id || m.player_a2_id === user.id ||
      teamIds.includes(m.team_a_id);
    const myScore = isSideA ? (m.score_a ?? 0) : (m.score_b ?? 0);
    const oppScore = isSideA ? (m.score_b ?? 0) : (m.score_a ?? 0);
    pf += myScore; pa += oppScore;
    if (myScore > oppScore) wins++;
    else losses++;
  }

  const tournaments = (playerRows ?? []).map((r: any) => r.tournament as Tournament);

  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title="My Profile" />
      <div className="px-4 py-6 space-y-5">

        {/* Profile card */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={profile?.avatar_url ?? ""} />
                <AvatarFallback className="text-xl">
                  {getInitials(profile?.first_name, profile?.last_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-black text-gray-900">
                  {profile?.first_name} {profile?.last_name}
                </h1>
                <p className="text-sm text-gray-500">{profile?.email}</p>
                {profile?.dupr_rating && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-gray-400">DUPR</span>
                    <span className={`text-sm font-black ${duprRatingColor(profile.dupr_rating)}`}>
                      {profile.dupr_rating.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4">
              <EditProfileForm profile={profile as Profile} />
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Tournaments", value: tournaments.length, icon: Trophy },
            { label: "Matches",     value: allMatches.length,  icon: Calendar },
            { label: "Wins",        value: wins,               icon: TrendingUp },
            { label: "Win %",       value: allMatches.length > 0 ? `${Math.round(wins / allMatches.length * 100)}%` : "–", icon: Target },
          ].map((s) => (
            <Card key={s.label} className="text-center">
              <CardContent className="py-3 px-1">
                <div className="text-lg font-black text-brand-500">{s.value}</div>
                <div className="text-[10px] text-gray-400 font-medium leading-tight mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tournaments history */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand-500" />
              Tournament History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tournaments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No tournaments yet</p>
            ) : (
              tournaments.map((t) => (
                <Link key={t.id} href={`/tournaments/${t.id}`}>
                  <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                      <div className="text-xs text-gray-400">{tournamentTypeLabel(t.type)} · {formatDate(t.created_at)}</div>
                    </div>
                    <Badge variant={t.status === "completed" ? "secondary" : "default"} className="text-[10px]">
                      {statusLabel(t.status)}
                    </Badge>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent matches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Matches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {allMatches.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No matches played yet</p>
            ) : (
              allMatches.slice(0, 10).map((m: any) => {
                const isSideA = m.player_a1_id === user.id || m.player_a2_id === user.id ||
                  teamIds.includes(m.team_a_id);
                const myScore = isSideA ? m.score_a : m.score_b;
                const oppScore = isSideA ? m.score_b : m.score_a;
                const won = myScore > oppScore;
                return (
                  <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <span className={`text-xs font-bold ${won ? "text-green-600" : "text-red-500"}`}>
                        {won ? "WIN" : "LOSS"}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">
                        Round {m.round?.round_number}
                      </span>
                    </div>
                    <div className="font-mono text-sm font-bold text-gray-700">
                      {myScore} – {oppScore}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
