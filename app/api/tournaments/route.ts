import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { FinalsFormat, FinalsTrigger, SecondRoundFormat, TournamentType } from "@/types/database";

type CreateTournamentBody = {
  name?: string;
  court_count?: number;
  max_players?: number;
  type?: TournamentType;
  games_per_player?: number | null;
  advancement_count?: number | null;
  rules_text?: string | null;
  is_public?: boolean;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return jsonError("Not authenticated", 401);

  const body = (await request.json().catch(() => null)) as CreateTournamentBody | null;
  if (!body) return jsonError("Invalid request body");

  const name = body.name?.trim();
  const courtCount = Number(body.court_count);
  const maxPlayers = Number(body.max_players);
  const type = body.type;

  if (!name) return jsonError("Tournament name is required");
  if (!Number.isInteger(courtCount) || courtCount < 1) return jsonError("At least 1 court is required");
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2) return jsonError("At least 2 players are required");
  if (!type || !["singles", "doubles", "mixed"].includes(type)) return jsonError("Invalid tournament type");

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const meta = user.user_metadata ?? {};
  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email: user.email ?? "",
    first_name: meta.given_name ?? meta.name?.split(" ")[0] ?? "",
    last_name: meta.family_name ?? meta.name?.split(" ").slice(1).join(" ") ?? "",
    avatar_url: meta.avatar_url ?? meta.picture ?? null,
  }, { onConflict: "id" });

  if (profileError) return jsonError(profileError.message, 500);

  const { data: tournament, error: tournamentError } = await admin.from("tournaments").insert({
    name,
    created_by: user.id,
    court_count: courtCount,
    max_players: maxPlayers,
    type,
    games_per_player: body.games_per_player ?? null,
    second_round_format: "none" as SecondRoundFormat,
    advancement_count: body.advancement_count && body.advancement_count > 0 ? body.advancement_count : null,
    finals_format: "none" as FinalsFormat,
    finals_trigger: "none" as FinalsTrigger,
    rules_text: body.rules_text?.trim() || null,
    is_public: body.is_public ?? true,
    status: "registration",
  }).select().single();

  if (tournamentError) {
    const status = tournamentError.code === "23505" ? 409 : 500;
    return jsonError(tournamentError.message, status);
  }

  const { error: playerError } = await admin.from("tournament_players").insert({
    tournament_id: tournament.id,
    user_id: user.id,
    status: "approved",
    joined_via: "invite",
  });

  if (playerError) return jsonError(playerError.message, 500);

  if (type === "doubles") {
    const teamCount = Math.max(2, Math.floor(maxPlayers / 2));
    const teams = Array.from({ length: teamCount }, (_, index) => ({
      tournament_id: tournament.id,
      name: `Team ${index + 1}`,
    }));

    const { error } = await admin.from("teams").insert(teams);
    if (error) return jsonError(error.message, 500);
  } else if (type === "singles") {
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", user.id)
      .single();

    const teamName = profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
      : user.email ?? "Creator";

    const { data: team, error: teamError } = await admin
      .from("teams")
      .insert({ tournament_id: tournament.id, name: teamName })
      .select()
      .single();

    if (teamError) return jsonError(teamError.message, 500);

    const { error: memberError } = await admin.from("team_members").insert({
      team_id: team.id,
      user_id: user.id,
    });

    if (memberError) return jsonError(memberError.message, 500);
  }

  return NextResponse.json({ tournament });
}
