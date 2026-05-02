import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { MobileHeader } from "@/components/layout/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScoreEntryButton } from "@/components/tournament/score-entry-button";
import { getInitials, statusLabel, duprRatingColor } from "@/lib/utils";
import type { Profile, Round, Match, Tournament } from "@/types/database";

export default async function MatchesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: tournamentData } = await supabase
    .from("tournaments").select("*").eq("id", id).single();
  if (!tournamentData) notFound();
  const tournament = tournamentData as Tournament;

  // Check admin
  const { data: adminRow } = await supabase
    .from("tournament_admins").select("id").eq("tournament_id", id).eq("user_id", user.id).single();
  const isAdmin = !!adminRow;

  const { data: rounds } = await supabase
    .from("rounds").select("*").eq("tournament_id", id).order("round_number");

  // Fetch matches with joined player/team data
  const { data: matches } = await supabase
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

  const roundMap = new Map((rounds ?? []).map((r: Round) => [r.id, r]));

  const matchesByRound = new Map<string, any[]>();
  for (const m of (matches ?? []) as any[]) {
    const arr = matchesByRound.get(m.round_id) ?? [];
    arr.push(m);
    matchesByRound.set(m.round_id, arr);
  }

  const isMixed = tournament.type === "mixed";

  function PlayerChip({ profile }: { profile: Profile }) {
    return (
      <div className="flex items-center gap-1.5">
        <Avatar className="h-6 w-6">
          <AvatarImage src={profile.avatar_url ?? ""} />
          <AvatarFallback className="text-xs">{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
        </Avatar>
        <span className="text-xs font-medium text-gray-800 truncate max-w-[80px]">
          {profile.first_name} {profile.last_name?.[0]}.
        </span>
        {profile.dupr_rating && (
          <span className={`text-[10px] font-bold ${duprRatingColor(profile.dupr_rating)}`}>
            {profile.dupr_rating.toFixed(1)}
          </span>
        )}
      </div>
    );
  }

  function TeamDisplay({ match, side }: { match: any; side: "a" | "b" }) {
    if (isMixed) {
      const p1 = side === "a" ? match.player_a1 : match.player_b1;
      const p2 = side === "a" ? match.player_a2 : match.player_b2;
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

  const statusBadge = (s: string) => {
    const v = { scheduled: "secondary", in_progress: "default", score_entered: "warning", validated: "success", disputed: "danger" }[s] ?? "secondary";
    return <Badge variant={v as any} className="text-[10px]">{statusLabel(s)}</Badge>;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title="Matches" back={`/tournaments/${id}`} />
      <div className="px-4 py-6 space-y-6">
        {(rounds ?? []).length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="font-semibold">No rounds scheduled yet</p>
            <p className="text-sm mt-1">The admin will generate matches soon</p>
          </div>
        )}

        {(rounds ?? []).map((round: Round) => (
          <div key={round.id}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900">
                Round {round.round_number} —{" "}
                <span className="text-brand-500 capitalize">{round.round_type.replace("_", " ")}</span>
              </h2>
              <Badge variant={round.status === "completed" ? "success" : round.status === "active" ? "default" : "secondary"}>
                {round.status}
              </Badge>
            </div>

            <div className="space-y-3">
              {(matchesByRound.get(round.id) ?? []).map((match: any) => (
                <Card key={match.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    {/* Court indicator */}
                    <div className="bg-brand-500 text-white text-xs font-bold px-3 py-1 flex justify-between">
                      <span>Court {match.court_number ?? "?"}</span>
                      {statusBadge(match.status)}
                    </div>

                    <div className="p-3">
                      <div className="flex items-center gap-2">
                        {/* Team A */}
                        <div className="flex-1">
                          <TeamDisplay match={match} side="a" />
                        </div>

                        {/* Score */}
                        <div className="flex items-center gap-2 mx-2">
                          <div className={`text-2xl font-black w-8 text-center ${
                            match.score_a != null && match.score_b != null
                              ? match.score_a > match.score_b ? "text-brand-500" : "text-gray-400"
                              : "text-gray-300"
                          }`}>
                            {match.score_a ?? "–"}
                          </div>
                          <div className="text-gray-300 text-sm font-bold">:</div>
                          <div className={`text-2xl font-black w-8 text-center ${
                            match.score_a != null && match.score_b != null
                              ? match.score_b > match.score_a ? "text-brand-500" : "text-gray-400"
                              : "text-gray-300"
                          }`}>
                            {match.score_b ?? "–"}
                          </div>
                        </div>

                        {/* Team B */}
                        <div className="flex-1 flex justify-end">
                          <TeamDisplay match={match} side="b" />
                        </div>
                      </div>

                      {/* Score entry / validation */}
                      <ScoreEntryButton
                        match={match}
                        userId={user.id}
                        isAdmin={isAdmin}
                        isMixed={isMixed}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
