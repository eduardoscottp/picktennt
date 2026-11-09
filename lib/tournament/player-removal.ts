"use server";

import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function checked(query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function requirePlayerAdmin(supabase: SupabaseClient, tournamentPlayerId: string) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in to manage tournament players.");
  const { data: tp, error: playerError } = await supabase.from("tournament_players")
    .select("user_id, tournament_id").eq("id", tournamentPlayerId).single();
  if (playerError || !tp) throw new Error("Player record not found.");
  const { data: tournament, error: tournamentError } = await supabase.from("tournaments")
    .select("type, engine_version, created_by, status").eq("id", tp.tournament_id).single();
  if (tournamentError || !tournament) throw new Error("Tournament not found.");
  if (tournament.engine_version !== "legacy") throw new Error("Use this tournament's player management controls.");
  const { data: admin, error: adminError } = await supabase.from("tournament_admins")
    .select("id").eq("tournament_id", tp.tournament_id).eq("user_id", user.id).maybeSingle();
  if (adminError || (!admin && tournament.created_by !== user.id)) throw new Error("Tournament administrator access is required.");
  if (!["draft", "registration"].includes(tournament.status)) throw new Error("Use Retirar equipo after the tournament starts.");
  return { ...tp, tournament };
}

async function getPlayerTeamId(supabase: SupabaseClient, userId: string, tournamentId: string): Promise<string | null> {
  const { data, error } = await supabase.from("team_members").select("team_id")
    .eq("user_id", userId).eq("tournament_id", tournamentId).maybeSingle();
  if (error) throw new Error("Could not load the player's team.");
  return data?.team_id ?? null;
}

export async function removePlayerSimple(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();
  const tp = await requirePlayerAdmin(supabase, tournamentPlayerId);
  const { count, error } = await supabase.from("rounds").select("id", { count: "exact", head: true }).eq("tournament_id", tp.tournament_id);
  if (error) throw new Error("Could not check the schedule.");
  if (count) throw new Error("Review the scheduled matches before removing this player.");
  const teamId = await getPlayerTeamId(supabase, tp.user_id, tp.tournament_id);
  if (teamId) {
    await checked(supabase.from("team_members").delete().eq("user_id", tp.user_id).eq("team_id", teamId));
    // Empty doubles teams are registration positions and must remain available.
    if (tp.tournament.type === "singles") {
      const { count: members, error: membersError } = await supabase.from("team_members")
        .select("id", { count: "exact", head: true }).eq("team_id", teamId);
      if (membersError) throw new Error("Could not check the remaining team members.");
      if (members === 0) await checked(supabase.from("teams").delete().eq("id", teamId));
    }
  }
  await checked(supabase.from("tournament_players").update({ status: "rejected" }).eq("id", tournamentPlayerId));
}

export async function deleteAllRoundsAndRemovePlayer(tournamentPlayerId: string, tournamentId: string): Promise<void> {
  const supabase = await createClient();
  const tp = await requirePlayerAdmin(supabase, tournamentPlayerId);
  if (tp.tournament_id !== tournamentId) throw new Error("Player belongs to another tournament.");
  const { count, error } = await supabase.from("matches").select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId).neq("status", "scheduled");
  if (error) throw new Error("Could not check existing results.");
  if (count) throw new Error("The schedule cannot be removed after play or a result has been recorded.");
  await checked(supabase.from("rounds").delete().eq("tournament_id", tournamentId));
  await checked(supabase.from("tournaments").update({ status: "registration" }).eq("id", tournamentId));
  await removePlayerSimple(tournamentPlayerId);
}

export async function forfeitLegacyTeam(tournamentId: string, teamId: string): Promise<{ affectedMatches: number }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in to withdraw a team.");
  const { data, error } = await supabase.rpc("legacy_forfeit_team", { p_tournament_id: tournamentId, p_team_id: teamId });
  if (error) {
    const messages: Record<string, string> = {
      FORBIDDEN: "Tournament administrator access is required.",
      NOT_FOUND: "This legacy team is unavailable.",
      INVALID_STATE: "Team withdrawal is available after a singles or doubles tournament starts.",
      TEAM_WITHDRAWN: "This team has already been withdrawn.",
      STALE_ROSTER: "This team's roster changed. Refresh the page.",
      INCOMPLETE_OPPONENT: "An opponent is not yet assigned. Review the bracket before withdrawing this team.",
      OPPONENT_WITHDRAWN: "An opponent has already withdrawn. These conflicting results need manual result management.",
      INVALID_BRACKET: "Review the bracket links before withdrawing this team.",
      BRACKET_REVIEW_REQUIRED: "El retiro cambia participantes de un cruce ya asignado; revisa sus resultados manualmente.",
      PLAYED_DESCENDANT: "This would change participants in an already resolved bracket match. Use manual result management.",
    };
    throw new Error(messages[error.message] ?? "Could not withdraw this team.");
  }
  return { affectedMatches: Number(data) };
}
