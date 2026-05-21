import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { collectMatchUserIds, fetchProfiles, resolveMatchPlayers } from "@/lib/dupr/tournament-helpers";
import { resolveDuprNumericIds, DuprError } from "@/lib/dupr/client";
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
  if (!adminRow) return NextResponse.json({ error: "Not a tournament admin" }, { status: 403 });

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: matchesRaw } = await admin
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .eq("status", "validated");
  const matches = (matchesRaw ?? []) as Match[];

  const userIds = await collectMatchUserIds(admin, matches);
  const profiles = await fetchProfiles(admin, Array.from(userIds));

  const missing: Pick<Profile, "id" | "first_name" | "last_name" | "email">[] = [];
  for (const uid of userIds) {
    const p = profiles.get(uid);
    if (!p) continue;
    if (!p.dupr_id || p.dupr_id.trim() === "") {
      missing.push({ id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email });
    }
  }

  let notInClub: { id: string; first_name: string | null; last_name: string | null; email: string; duprId: string }[] = [];
  let clubLookupError: string | null = null;

  if (missing.length === 0 && matches.length > 0) {
    const clubIdEnv = process.env.DUPR_GROUP_ID;
    if (clubIdEnv) {
      const duprCodes = Array.from(userIds)
        .map((uid) => profiles.get(uid)?.dupr_id)
        .filter((s): s is string => !!s);
      try {
        const numericMap = await resolveDuprNumericIds(Number(clubIdEnv), duprCodes);
        for (const uid of userIds) {
          const p = profiles.get(uid);
          if (!p || !p.dupr_id) continue;
          if (!numericMap.has(p.dupr_id)) {
            notInClub.push({
              id: p.id,
              first_name: p.first_name,
              last_name: p.last_name,
              email: p.email,
              duprId: p.dupr_id,
            });
          }
        }
      } catch (err) {
        const e = err as DuprError;
        clubLookupError = `DUPR club lookup failed (${e.status}): ${typeof e.body === "string" ? e.body : JSON.stringify(e.body)}`;
      }
    }
  }

  // Build match preview for confirmation dialog
  const resolved = await resolveMatchPlayers(admin, matches, profiles);
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
    ok: missing.length === 0 && notInClub.length === 0 && !clubLookupError,
    validatedMatchCount: matches.length,
    totalPlayers: userIds.size,
    missing,
    notInClub,
    clubLookupError,
    preview,
  });
}
