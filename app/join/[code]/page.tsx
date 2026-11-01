import { redirectModularJoin } from "@/lib/tournament-builder/server-page";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { statusLabel, tournamentTypeLabel } from "@/lib/utils";
import { redirect } from "next/navigation";
import { JoinButton } from '@/components/tournament/join-button';

export default async function JoinByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  // Use service role to look up tournament — unauthenticated users can't read via RLS
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: tournament } = await admin
    .from("tournaments")
    .select("id, name, type, status, max_players, court_count")
    .eq("join_code", code.toUpperCase())
    .single();

  if (tournament) await redirectModularJoin(tournament.id);

  const { data: { user } } = await supabase.auth.getUser();

  // Returning from authentication never enrolls a player during a page read.
  if (user && tournament) {
    // Check if already a player
    const { data: existing } = await admin
      .from("tournament_players")
      .select("id")
      .eq("tournament_id", tournament.id)
      .eq("user_id", user.id)
      .single();

    if (existing) redirect(`/tournaments/${tournament.id}`);
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-white">
            PICK<span className="text-brand-200">TENNT</span>
          </h1>
          <p className="text-brand-100 text-sm mt-1">You&apos;ve been invited to a tournament</p>
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
                <p className="text-sm text-gray-500 mb-6">Review this invitation before joining.</p>
                {user ? tournament.status === 'registration' ? <JoinButton tournamentId={tournament.id} userId={user.id} autoApprove tournamentType={tournament.type} /> : <p role="status" className="text-sm text-gray-600">Registration is not open. Contact the organizer.</p> : <Link href={`/login?redirect=${encodeURIComponent(`/join/${code}`)}`}>
                  <Button className="w-full" size="lg">
                    Sign in to Join
                  </Button>
                </Link>}
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-brand-100 text-xs mt-4">
          Sign in or create an account with Apple, Google, or email.
        </p>
      </div>
    </div>
  );
}

