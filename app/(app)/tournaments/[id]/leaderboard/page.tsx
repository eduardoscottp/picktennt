import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { MobileHeader } from "@/components/layout/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials, duprRatingColor, tournamentTypeLabel } from "@/lib/utils";
import { computeStandings } from "@/lib/tournament/standings";
import { TournamentBottomNav } from "@/components/tournament/tournament-bottom-nav";
import type { Match, Profile, Tournament } from "@/types/database";
import { Trophy } from "lucide-react";

const RANK_ICONS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tournamentData } = await supabase
    .from("tournaments").select("*").eq("id", id).single();
  const tournament = tournamentData as Tournament | null;
  if (!tournament) notFound();

  const isMixed = tournament.type === "mixed";
  const isDoubles = tournament.type === "doubles";

  const { data: adminRow } = user
    ? await supabase.from("tournament_admins").select("id").eq("tournament_id", id).eq("user_id", user.id).single()
    : { data: null };
  const isAdmin = !!adminRow;

  // Fetch all validated matches
  const { data: matches } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .eq("status", "validated");

  const allMatches = (matches ?? []) as Match[];
  const standings = computeStandings(allMatches, isMixed ? "player" : "team");

  // Fetch entity details
  const entityMap = new Map<string, { name: string; avatar?: string; rating?: number | null }>();
  let teamsForDoubles: any[] = [];

  if (isMixed) {
    const playerIds = standings.map((s) => s.id);
    if (playerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles").select("*").in("id", playerIds);
      for (const p of (profiles ?? []) as Profile[]) {
        entityMap.set(p.id, {
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
          avatar: p.avatar_url ?? undefined,
          rating: p.dupr_rating,
        });
      }
    }
  } else {
    // Fetch all teams in the tournament (not just ranked ones) to get member data
    const { data: teamsRaw } = await supabase
      .from("teams")
      .select("*, team_members(user_id, profile:profiles(id, first_name, last_name, avatar_url, dupr_rating))")
      .eq("tournament_id", id);
    teamsForDoubles = (teamsRaw ?? []) as any[];

    for (const t of teamsForDoubles) {
      const members: any[] = t.team_members ?? [];
      const names = members
        .map((m: any) => `${m.profile?.first_name ?? ""} ${m.profile?.last_name ?? ""}`.trim())
        .filter(Boolean)
        .join(" / ");
      entityMap.set(t.id, { name: names || "Team" });
    }
  }


  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title="Standings" back={`/tournaments/${id}`} />
      <div className="px-4 py-6 pb-32 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black text-gray-900">Leaderboard</h1>
          <Badge variant="secondary">{tournamentTypeLabel(tournament.type)}</Badge>
        </div>

        {isDoubles && standings.length > 0 && (
          <h2 className="text-lg font-black text-gray-900">Team Standings</h2>
        )}

        {standings.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Trophy className="h-10 w-10 mx-auto mb-3 text-gray-200" />
            <p className="font-semibold">No results yet</p>
            <p className="text-sm">Standings will appear after matches are validated</p>
          </div>
        ) : (
          <div className="space-y-2">
            {standings.map((row, idx) => {
              const entity = entityMap.get(row.id);
              const isTop3 = idx < 3;
              return (
                <Card key={row.id} className={isTop3 ? "border-brand-200 shadow-md" : ""}>
                  <CardContent className="grid grid-cols-[2rem_minmax(0,1fr)_3rem] items-center gap-3 py-3 px-4">
                    {/* Rank */}
                    <div className="text-center">
                      {idx < 3 ? (
                        <span className="text-xl">{RANK_ICONS[idx]}</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-400">#{row.rank}</span>
                      )}
                    </div>

                    {/* Name */}
                    <div className="flex items-center gap-2 min-w-0">
                      {isMixed && (
                        <Avatar className="h-9 w-9 flex-shrink-0">
                          <AvatarImage src={entity?.avatar ?? ""} />
                          <AvatarFallback>{getInitials(entity?.name?.split(" ")[0], entity?.name?.split(" ")[1])}</AvatarFallback>
                        </Avatar>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-gray-900 truncate whitespace-nowrap min-w-0">
                            {entity?.name ?? row.id.slice(0, 8)}
                          </span>
                          {isMixed && entity?.rating && (
                            <span className={`text-xs font-bold flex-shrink-0 ${duprRatingColor(entity.rating)}`}>
                              {entity.rating.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">
                          {row.wins}W – {row.losses}L · {row.pointsFor}:{row.pointsAgainst}
                        </div>
                      </div>
                    </div>

                    {/* Win count */}
                    <div className="text-right justify-self-end">
                      <div className="text-lg font-black text-brand-500">{row.wins}</div>
                      <div className="text-[10px] text-gray-400">wins</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Tiebreaker note */}
        <p className="text-xs text-gray-400 text-center">
          Tiebreaker: fewer points conceded against tied opponents ranks higher.
        </p>

      </div>
      <TournamentBottomNav tournamentId={id} isAdmin={isAdmin} />
    </div>
  );
}
