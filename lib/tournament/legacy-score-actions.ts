"use server";

import { createClient } from "@/lib/supabase/server";

export async function recordLegacyAdminScore(matchId: string, scoreA?: number, scoreB?: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in to validate a score.");
  const { error } = await supabase.rpc("legacy_record_admin_score", {
    p_match_id: matchId, p_score_a: scoreA ?? null, p_score_b: scoreB ?? null,
  });
  if (error) {
    const messages: Record<string, string> = {
      FORBIDDEN: "Tournament administrator access is required.",
      NOT_FOUND: "This legacy match is unavailable.",
      INVALID_SCORE: "Enter different non-negative whole-number scores.",
      INVALID_STATE: "This match cannot be scored at its current stage.",
      TEAM_WITHDRAWN: "A withdrawn team's results require manual result management.",
      PLAYED_DESCENDANT: "This score would change a bracket match that has already started.",
      INVALID_BRACKET: "Review the bracket links before changing this result.",
    };
    throw new Error(messages[error.message] ?? "Could not save this score.");
  }
}
