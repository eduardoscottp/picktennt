import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { statusLabel, tournamentTypeLabel } from "@/lib/utils";
import { redirect } from "next/navigation";

export default async function JoinByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, name, type, status, max_players, court_count")
    .eq("join_code", code.toUpperCase())
    .single();

  const { data: { user } } = await supabase.auth.getUser();

  // Logged-in user with valid tournament: auto-approve and redirect
  if (user && tournament) {
    // Check if already a player
    const { data: existing } = await supabase
      .from("tournament_players")
      .select("id")
      .eq("tournament_id", tournament.id)
      .eq("user_id", user.id)
      .single();

    if (!existing) {
      // Use service role to bypass RLS for team creation
      const admin = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      await admin.from("tournament_players").insert({
        tournament_id: tournament.id,
        user_id: user.id,
        status: "approved",
        joined_via: "link",
      });

      // Singles: auto-create a team for the player
      if (tournament.type === "singles") {
        const { data: profile } = await admin
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("id", user.id)
          .single();
        const teamName = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
          : user.email ?? "Player";
        const { data: team } = await admin
          .from("teams")
          .insert({ tournament_id: tournament.id, name: teamName })
          .select()
          .single();
        if (team) {
          await admin.from("team_members").insert({ team_id: team.id, user_id: user.id });
        }
      }
    }

    redirect(`/tournaments/${tournament.id}`);
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-white">
            PICK<span className="text-brand-200">TENNT</span>
          </h1>
          <p className="text-brand-100 text-sm mt-1">You've been invited to a tournament</p>
        </div>

        <Card className="overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-brand-400 to-brand-600" />
          <CardContent className="py-6 text-center">
            {!tournament ? (
              <div>
                <Trophy className="h-12 w-12 text-gray-200 mx-auto mb-3" />
                <p className="font-semibold text-gray-500">Tournament not found</p>
                <p className="text-sm text-gray-400 mt-1">Check the code or link and try again</p>
              </div>
            ) : (
              <>
                <Trophy className="h-10 w-10 text-brand-500 mx-auto mb-3" />
                <h2 className="text-xl font-black text-gray-900 mb-2">{tournament.name}</h2>
                <div className="flex justify-center gap-2 mb-5">
                  <Badge variant="default">{statusLabel(tournament.status)}</Badge>
                  <Badge variant="secondary">{tournamentTypeLabel(tournament.type)}</Badge>
                </div>
                <p className="text-sm text-gray-500 mb-6">
                  Sign in to join this tournament and track your matches.
                </p>
                <Link href={`/login?redirect=/join/${code}`}>
                  <Button className="w-full" size="lg">
                    Sign in to Join
                  </Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-brand-100 text-xs mt-4">
          Don't have an account? You'll create one when you sign in with Google.
        </p>
      </div>
    </div>
  );
}
