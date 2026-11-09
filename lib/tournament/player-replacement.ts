"use server";

import { createClient } from "@/lib/supabase/server";

const messages: Record<string, string> = {
  UNAUTHENTICATED: "Sign in to manage tournament players.",
  FORBIDDEN: "You cannot assign a player to this position.",
  NOT_FOUND: "This team is unavailable for legacy player management.",
  INVALID_STATE: "Player assignment is unavailable at this tournament stage.",
  INVALID_REQUEST: "Choose a different registered player.",
  ACCOUNT_REQUIRED: "Choose an existing Picktennt player.",
  DUPLICATE_ENTRY: "This player already occupies a tournament position.",
  SLOT_FULL: "This team is full. Refresh the roster.",
  STALE_ROSTER: "This position changed. Refresh the roster.",
  ROSTER_WITHDRAWN: "Player assignment cannot reactivate a withdrawn or disqualified roster.",
  CAPACITY_FULL: "The tournament has reached its player capacity.",
  MATCH_IN_PROGRESS: "Resolve this team's live or provisional matches before changing its players.",
  AMBIGUOUS_HISTORY: "Historical match players are missing. Review those lineups before changing this team.",
};

async function setPlayer(tournamentId: string, teamId: string, userId: string, oldUserId: string | null) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error(messages.UNAUTHENTICATED);
  const { error } = await supabase.rpc("legacy_set_team_player", {
    p_tournament_id: tournamentId, p_team_id: teamId, p_user_id: userId, p_old_user_id: oldUserId,
  });
  if (error) throw new Error(messages[error.message] ?? "Could not update this tournament position.");
}

export async function assignLegacyPlayer(tournamentId: string, teamId: string, userId: string): Promise<void> {
  await setPlayer(tournamentId, teamId, userId, null);
}

export async function replaceLegacyPlayer(tournamentId: string, teamId: string, oldUserId: string, newUserId: string): Promise<void> {
  await setPlayer(tournamentId, teamId, newUserId, oldUserId);
}
