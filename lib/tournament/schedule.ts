import { generateMixedSchedule } from "./mixed-pairing";
import { generateRoundRobinSchedule } from "./round-robin";
import type { Tournament } from "@/types/database";

type SupabaseClient = any;

/** Fetches teams in stable creation order */
async function fetchTeamIds(supabase: SupabaseClient, tournamentId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t: any) => t.id as string);
}

/** Fetches approved players in stable creation order */
async function fetchPlayerIds(supabase: SupabaseClient, tournamentId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("tournament_players")
    .select("user_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "approved")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p: any) => p.user_id as string);
}

/** Inserts a single round + its matches into the DB */
async function insertRound(
  supabase: SupabaseClient,
  tournamentId: string,
  roundNumber: number,
  roundType: string,
  matchRows: object[]
) {
  const { data: round, error: roundError } = await supabase
    .from("rounds")
    .insert({ tournament_id: tournamentId, round_number: roundNumber, round_type: roundType, status: "active" })
    .select()
    .single();
  if (roundError) throw roundError;

  if (matchRows.length > 0) {
    const { error } = await supabase.from("matches").insert(
      matchRows.map((m) => ({ ...m, tournament_id: tournamentId, round_id: round.id, status: "scheduled" }))
    );
    if (error) throw error;
  }
  return round;
}

/**
 * Deletes all existing rounds (cascade-removes matches) then generates
 * the full round-robin schedule. Returns number of rounds created.
 */
export async function generateAndSaveSchedule(
  supabase: SupabaseClient,
  tournament: Tournament
): Promise<number> {
  // Clear existing rounds (matches cascade-deleted)
  const { error: delError } = await supabase
    .from("rounds")
    .delete()
    .eq("tournament_id", tournament.id);
  if (delError) throw delError;

  if (tournament.type === "mixed") {
    const playerIds = await fetchPlayerIds(supabase, tournament.id);
    const gamesPerPlayer = tournament.games_per_player ?? 4;
    const schedule = generateMixedSchedule(playerIds, tournament.court_count, gamesPerPlayer);

    for (let i = 0; i < schedule.length; i++) {
      await insertRound(supabase, tournament.id, i + 1, "round_robin",
        schedule[i].matches.map((m) => ({
          court_number: m.court,
          player_a1_id: m.teamA[0],
          player_a2_id: m.teamA[1],
          player_b1_id: m.teamB[0],
          player_b2_id: m.teamB[1],
        }))
      );
    }
    return schedule.length;
  } else {
    const teamIds = await fetchTeamIds(supabase, tournament.id);
    const maxRounds = tournament.games_per_player ?? (teamIds.length - 1);
    const full = generateRoundRobinSchedule(teamIds, tournament.court_count);
    const schedule = full.slice(0, maxRounds);

    for (let i = 0; i < schedule.length; i++) {
      await insertRound(supabase, tournament.id, i + 1, "round_robin",
        schedule[i].map(([a, b], idx) => ({ court_number: idx + 1, team_a_id: a, team_b_id: b }))
      );
    }
    return schedule.length;
  }
}
