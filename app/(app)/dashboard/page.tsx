import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Trophy, Plus, Clock, CheckCircle, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusLabel, tournamentTypeLabel } from "@/lib/utils";
import type { Tournament, Profile } from "@/types/database";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileData } = await supabase
    .from("profiles").select("*").eq("id", user!.id).single();
  const profile = profileData as Profile | null;

  // Tournaments where user is a player (approved)
  const { data: playerRows } = await supabase
    .from("tournament_players")
    .select("tournament_id, status, tournaments(*)")
    .eq("user_id", user!.id)
    .eq("status", "approved");

  // Tournaments where user is an admin
  const { data: adminRows } = await supabase
    .from("tournament_admins")
    .select("tournament_id, tournaments(*)")
    .eq("user_id", user!.id);

  const myTournaments = (playerRows ?? []).map((r: any) => r.tournaments as Tournament);
  const adminTournaments = (adminRows ?? []).map((r: any) => r.tournaments as Tournament);

  // Pending join requests for each tournament the user admins
  const adminTournamentIds = (adminRows ?? []).map((r: any) => r.tournament_id as string);
  const pendingByTournament: Record<string, number> = {};
  if (adminTournamentIds.length > 0) {
    const { data: pendingRows } = await supabase
      .from("tournament_players")
      .select("tournament_id")
      .in("tournament_id", adminTournamentIds)
      .eq("status", "pending");
    for (const p of pendingRows ?? []) {
      pendingByTournament[p.tournament_id] = (pendingByTournament[p.tournament_id] ?? 0) + 1;
    }
  }

  // Stats
  const { data: validatedMatches } = await supabase
    .from("matches")
    .select("id, score_a, score_b, team_a_id, team_b_id, player_a1_id, player_b1_id")
    .eq("status", "validated")
    .or(`player_a1_id.eq.${user!.id},player_b1_id.eq.${user!.id}`);

  const wins = (validatedMatches ?? []).filter((m: any) => {
    if (m.player_a1_id === user!.id) return (m.score_a ?? 0) > (m.score_b ?? 0);
    return (m.score_b ?? 0) > (m.score_a ?? 0);
  }).length;

  const statusVariant = (s: string) => {
    if (s === "active" || s === "finals") return "success";
    if (s === "completed") return "secondary";
    if (s === "registration") return "default";
    return "secondary";
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-black text-gray-900">
          Hey, {profile?.first_name ?? "Player"} 👋
        </h1>
        <p className="text-gray-500 text-sm">Ready to play?</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Tournaments", value: myTournaments.length, icon: Trophy },
          { label: "Matches",     value: validatedMatches?.length ?? 0, icon: Clock },
          { label: "Wins",        value: wins, icon: CheckCircle },
        ].map((s) => (
          <Card key={s.label} className="text-center">
            <CardContent className="pt-4 pb-3">
              <s.icon className="h-5 w-5 text-brand-500 mx-auto mb-1" />
              <div className="text-2xl font-black text-gray-900">{s.value}</div>
              <div className="text-xs text-gray-400 font-medium">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3">
        <Link href="/tournaments/create" className="flex-1">
          <Button className="w-full" size="lg">
            <Plus className="h-5 w-5" />
            New Tournament
          </Button>
        </Link>
        <Link href="/tournaments" className="flex-1">
          <Button variant="outline" className="w-full" size="lg">
            Browse
          </Button>
        </Link>
      </div>

      {/* My tournaments */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-brand-500" />
          My Tournaments
        </h2>
        {myTournaments.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <Trophy className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">You haven't joined any tournaments yet.</p>
              <Link href="/tournaments" className="mt-3 inline-block">
                <Button variant="outline" size="sm">Browse Tournaments</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {myTournaments.map((t) => (
              <Link key={t.id} href={`/tournaments/${t.id}`}>
                <Card className="hover:border-brand-200 transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 truncate">{t.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {tournamentTypeLabel(t.type)} · {formatDate(t.created_at)}
                      </div>
                    </div>
                    <Badge variant={statusVariant(t.status) as any}>
                      {statusLabel(t.status)}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Administering */}
      {adminTournaments.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Administering</h2>
          <div className="space-y-3">
            {adminTournaments.map((t) => {
              const pending = pendingByTournament[t.id] ?? 0;
              return (
                <Link key={t.id} href={`/tournaments/${t.id}/admin`}>
                  <Card className="hover:border-brand-200 transition-colors cursor-pointer border-dashed border-brand-200">
                    <CardContent className="flex items-center gap-3 py-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-900 truncate">{t.name}</div>
                        <div className="text-xs text-brand-500 font-medium">Administrator</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {pending > 0 && (
                          <span className="inline-flex items-center gap-1 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                            <Users className="h-3 w-3" />
                            {pending}
                          </span>
                        )}
                        <Badge variant="default">{statusLabel(t.status)}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
