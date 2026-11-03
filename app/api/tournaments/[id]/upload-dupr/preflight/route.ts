import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { collectMatchUserIds, fetchProfiles, resolveMatchPlayers } from "@/lib/dupr/tournament-helpers";
import type { Match, Profile } from "@/types/database";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: adminRow } = await supabase
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  const { data: event, error: eventError } = await supabase.from("tournaments")
    .select("created_by,engine_version,modular_state,results_under_review,revision").eq("id", id).maybeSingle();
  if (eventError) return NextResponse.json({ error: "Could not load tournament" }, { status: 503 });
  const modular = event?.engine_version === "modular_v1";
  if (!adminRow && !(modular && event.created_by === user.id)) return NextResponse.json({ error: "Not a tournament admin" }, { status: 403 });
  if (modular && (event.modular_state !== "completed" || event.results_under_review)) {
    return NextResponse.json({ error: "Complete the tournament and resolve results under review before DUPR submission" }, { status: 409 });
  }

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let matchQuery = admin
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .eq("status", "validated")
    .eq("submit_to_dupr", true);
  if (modular) matchQuery = matchQuery.eq("is_current", true).is("voided_at", null).is("excluded_at", null).eq("outcome_kind", "played");
  const { data: matchesRaw, error: matchesError } = await matchQuery;
  if (matchesError) return NextResponse.json({ error: "Could not load eligible matches" }, { status: 503 });
  const matches = (matchesRaw ?? []) as Match[];

  const userIds = await collectMatchUserIds(admin, matches, modular);

  // Exclude non-playing admins
  const { data: nonPlayingAdmins } = await admin
    .from("tournament_admins")
    .select("user_id")
    .eq("tournament_id", id)
    .eq("is_playing", false);
  const nonPlayingIds = new Set((nonPlayingAdmins ?? []).map((a: any) => a.user_id));
  if (!modular) for (const uid of nonPlayingIds) userIds.delete(uid);

  const profiles = await fetchProfiles(admin, Array.from(userIds));

  const missing: Pick<Profile, "id" | "first_name" | "last_name" | "email">[] = [];
  for (const uid of userIds) {
    const p = profiles.get(uid);
    if (!p) {
      if (modular) return NextResponse.json({ error: "An eligible match has a missing Picktennt profile" }, { status: 409 });
      continue;
    }
    if (!p.dupr_id || p.dupr_id.trim() === "") {
      missing.push({ id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email });
    }
  }

  // Build match preview for confirmation dialog
  const resolved = await resolveMatchPlayers(admin, matches, profiles, modular);
  const preview = resolved.map((r) => ({
    matchId: r.matchId,
    teamALabel: r.teamA
      .map((p) => `${p.profile.first_name ?? ""} ${p.profile.last_name ?? ""}`.trim() || p.profile.email)
      .join(" / ") || "(unknown)",
    teamBLabel: r.teamB
      .map((p) => `${p.profile.first_name ?? ""} ${p.profile.last_name ?? ""}`.trim() || p.profile.email)
      .join(" / ") || "(unknown)",
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    isTie: r.scoreA === r.scoreB,
  }));

  return NextResponse.json({
    ...(modular ? { revision: event.revision } : {}),
    ok: missing.length === 0,
    validatedMatchCount: matches.length,
    totalPlayers: userIds.size,
    missing,
    preview,
  });
}
