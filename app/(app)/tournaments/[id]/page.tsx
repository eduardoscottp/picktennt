import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Share2, Users, Trophy, BookOpen, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MobileHeader } from "@/components/layout/navbar";
import { formatDate, getInitials, statusLabel, tournamentTypeLabel, generateJoinUrl, duprRatingColor } from "@/lib/utils";
import { JoinButton } from "@/components/tournament/join-button";
import { ShareButton } from "@/components/tournament/share-button";
import type { Tournament, TournamentPlayer, Profile, Round } from "@/types/database";

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tournamentData } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .single();
  const tournament = tournamentData as Tournament | null;

  if (!tournament) notFound();

  // Check membership
  const { data: myPlayerRowData } = user ? await supabase
    .from("tournament_players")
    .select("*")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single() : { data: null };
  const myPlayerRow = myPlayerRowData as { status: string; id: string } | null;

  const { data: myAdminRow } = user ? await supabase
    .from("tournament_admins")
    .select("*")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single() : { data: null };

  const isAdmin = !!myAdminRow;
  const isMember = !!myPlayerRow && myPlayerRow.status === "approved";
  const canView = tournament.is_public || isMember || isAdmin;

  if (!canView) {
    redirect(`/login?redirect=/tournaments/${id}`);
  }

  // Fetch players
  const { data: players } = await supabase
    .from("tournament_players")
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .eq("status", "approved")
    .order("created_at");

  // Fetch rounds
  const { data: rounds } = await supabase
    .from("rounds")
    .select("*")
    .eq("tournament_id", id)
    .order("round_number");

  // Fetch admins
  const { data: admins } = await supabase
    .from("tournament_admins")
    .select("*, profile:profiles(*)")
    .eq("tournament_id", id)
    .order("succession_order");

  const joinUrl = generateJoinUrl(tournament.join_code);

  const statusColor = {
    draft: "secondary", registration: "default",
    active: "success", finals: "warning", completed: "secondary",
  }[tournament.status as string] ?? "secondary";

  return (
    <div className="max-w-2xl mx-auto">
      <MobileHeader title={tournament.name} back="/tournaments" />

      <div className="px-4 py-6 space-y-5">
        {/* Header card */}
        <Card className="overflow-hidden">
          <div className="h-3 bg-gradient-to-r from-brand-400 to-brand-600" />
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-black text-gray-900 leading-tight">{tournament.name}</h1>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={statusColor as any}>{statusLabel(tournament.status)}</Badge>
                  <Badge variant="secondary">{tournamentTypeLabel(tournament.type)}</Badge>
                  <Badge variant="secondary">{tournament.court_count} courts</Badge>
                </div>
                <p className="text-xs text-gray-400 mt-2">Created {formatDate(tournament.created_at)}</p>
              </div>

              <div className="flex gap-2 flex-shrink-0">
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

            {/* Join button for non-members */}
            {user && !isMember && !isAdmin && (
              <div className="mt-4">
                {myPlayerRow?.status === "pending" ? (
                  <div className="text-sm text-yellow-600 bg-yellow-50 rounded-xl px-4 py-2 font-medium">
                    Your request to join is pending approval
                  </div>
                ) : (
                  <JoinButton tournamentId={id} userId={user.id} />
                )}
              </div>
            )}
            {!user && (
              <Link href={`/login?redirect=/tournaments/${id}`} className="block mt-4">
                <Button className="w-full">Sign in to Join</Button>
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Rules */}
        {tournament.rules_text && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4 text-brand-500" />
                Tournament Rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {tournament.rules_text}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Navigation for members */}
        {(isMember || isAdmin) && (
          <div className="grid grid-cols-2 gap-3">
            <Link href={`/tournaments/${id}/matches`}>
              <Card className="hover:border-brand-200 transition-colors cursor-pointer text-center">
                <CardContent className="py-5">
                  <Trophy className="h-7 w-7 text-brand-500 mx-auto mb-2" />
                  <div className="font-semibold text-gray-900 text-sm">Matches</div>
                </CardContent>
              </Card>
            </Link>
            <Link href={`/tournaments/${id}/leaderboard`}>
              <Card className="hover:border-brand-200 transition-colors cursor-pointer text-center">
                <CardContent className="py-5">
                  <Trophy className="h-7 w-7 text-brand-500 mx-auto mb-2" />
                  <div className="font-semibold text-gray-900 text-sm">Standings</div>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}

        {/* Players */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-brand-500" />
              Players ({(players ?? []).length} / {tournament.max_players})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(players ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No players yet</p>
            ) : (
              (players ?? []).map((p: any) => {
                const profile = p.profile as Profile;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={profile.avatar_url ?? ""} />
                      <AvatarFallback>{getInitials(profile.first_name, profile.last_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm">
                        {profile.first_name} {profile.last_name}
                      </div>
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
      </div>
    </div>
  );
}
