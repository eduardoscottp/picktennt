"use server";

import { createClient } from "@/lib/supabase/server";

type SupabaseClient = any;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getPlayerTeamId(
  supabase: SupabaseClient,
  userId: string,
  tournamentId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("team_members")
    .select("team_id, teams!inner(tournament_id)")
    .eq("user_id", userId)
    .eq("teams.tournament_id", tournamentId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

function playerMatchFilter(isMixed: boolean, userId: string, teamId: string | null): string {
  if (isMixed) {
    return `player_a1_id.eq.${userId},player_a2_id.eq.${userId},player_b1_id.eq.${userId},player_b2_id.eq.${userId}`;
  }
  if (teamId) return `team_a_id.eq.${teamId},team_b_id.eq.${teamId}`;
  return "id.eq.00000000-0000-0000-0000-000000000000";
}

async function hasCompletedRoundRobin(
  supabase: SupabaseClient,
  tournamentId: string,
  matchFilter: string
): Promise<boolean> {
  const { data: rrRounds } = await supabase
    .from("rounds")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("round_type", "round_robin");
  const rrRoundIds = new Set((rrRounds ?? []).map((r: any) => r.id as string));
  if (rrRoundIds.size === 0) return true;

  const { data: scheduledMatches } = await supabase
    .from("matches")
    .select("id, round_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "scheduled")
    .or(matchFilter);

  const hasScheduledRR = (scheduledMatches ?? []).some((m: any) =>
    rrRoundIds.has(m.round_id)
  );
  return !hasScheduledRR;
}

// ─── Path A ───────────────────────────────────────────────────────────────────

export async function removePlayerSimple(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("user_id, tournament_id")
    .eq("id", tournamentPlayerId)
    .single();
  if (!tp) throw new Error("Player record not found");

  const { data: tm } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", tp.user_id)
    .maybeSingle();

  if (tm?.team_id) {
    await supabase
      .from("team_members")
      .delete()
      .eq("user_id", tp.user_id)
      .eq("team_id", tm.team_id);

    const { count } = await supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", tm.team_id);

    if ((count ?? 0) === 0) {
      await supabase.from("teams").delete().eq("id", tm.team_id);
    }
  }

  await supabase
    .from("tournament_players")
    .update({ status: "rejected" })
    .eq("id", tournamentPlayerId);
}

// ─── Path B ───────────────────────────────────────────────────────────────────

export async function deleteAllRoundsAndRemovePlayer(
  tournamentPlayerId: string,
  tournamentId: string
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("rounds").delete().eq("tournament_id", tournamentId);
  await supabase
    .from("tournaments")
    .update({ status: "registration" })
    .eq("id", tournamentId);
  await removePlayerSimple(tournamentPlayerId);
}

export async function removePlayerWithWalkovers(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("user_id, tournament_id, tournaments!inner(type)")
    .eq("id", tournamentPlayerId)
    .single();
  if (!tp) throw new Error("Player record not found");

  const userId = tp.user_id as string;
  const tournamentId = tp.tournament_id as string;
  const isMixed = (tp as any).tournaments?.type === "mixed";
  const teamId = isMixed ? null : await getPlayerTeamId(supabase, userId, tournamentId);
  const matchFilter = playerMatchFilter(isMixed, userId, teamId);

  await supabase
    .from("matches")
    .update({ status: "walkover", submit_to_dupr: false })
    .eq("tournament_id", tournamentId)
    .eq("status", "scheduled")
    .or(matchFilter);

  await supabase
    .from("tournament_players")
    .update({
      status: "rejected",
      exit_reason: "disqualified",
      nullified_from_standings: true,
    })
    .eq("id", tournamentPlayerId);
}

// ─── Path C ───────────────────────────────────────────────────────────────────

export async function processWithdrawal(tournamentPlayerId: string): Promise<void> {
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("user_id, tournament_id, tournaments!inner(type)")
    .eq("id", tournamentPlayerId)
    .single();
  if (!tp) throw new Error("Player record not found");

  const userId = tp.user_id as string;
  const tournamentId = tp.tournament_id as string;
  const isMixed = (tp as any).tournaments?.type === "mixed";
  const teamId = isMixed ? null : await getPlayerTeamId(supabase, userId, tournamentId);
  const matchFilter = playerMatchFilter(isMixed, userId, teamId);

  const rrComplete = await hasCompletedRoundRobin(supabase, tournamentId, matchFilter);

  await supabase
    .from("matches")
    .update({ status: "walkover", submit_to_dupr: false })
    .eq("tournament_id", tournamentId)
    .eq("status", "scheduled")
    .or(matchFilter);

  await supabase
    .from("tournament_players")
    .update({
      status: "rejected",
      exit_reason: "withdrew",
      nullified_from_standings: !rrComplete,
    })
    .eq("id", tournamentPlayerId);
}

export async function processRetirement(
  tournamentPlayerId: string,
  retiredMatchId: string | null,
  scoreA: number,
  scoreB: number
): Promise<void> {
  const supabase = await createClient();

  if (retiredMatchId) {
    await supabase
      .from("matches")
      .update({
        score_a: scoreA,
        score_b: scoreB,
        status: "score_entered",
        submit_to_dupr: true,
      })
      .eq("id", retiredMatchId);
  }

  await processWithdrawal(tournamentPlayerId);

  await supabase
    .from("tournament_players")
    .update({ exit_reason: "retired" })
    .eq("id", tournamentPlayerId);
}
