import { createClient } from "@/lib/supabase/server";
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

  // If user is logged in, redirect to tournament page so they can join there
  if (user && tournament) {
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
                <Link href={`/login?redirect=/tournaments/${tournament.id}`}>
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
