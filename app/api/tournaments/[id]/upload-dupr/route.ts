import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  collectMatchUserIds,
  fetchProfiles,
  resolveMatchPlayers,
} from "@/lib/dupr/tournament-helpers";
import {
  submitDuprMatch,
  resolveDuprNumericIdsBySearch,
  DuprError,
  type DuprMatchPayload,
} from "@/lib/dupr/client";
import type { Match, Profile, Tournament } from "@/types/database";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const { data: tournamentRaw } = await admin
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .single();
  const tournament = tournamentRaw as Tournament | null;
  if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  if (tournament.status !== "completed") {
    return NextResponse.json(
      { error: "Tournament must be completed before uploading to DUPR" },
      { status: 409 }
    );
  }

  const clubIdEnv = process.env.DUPR_GROUP_ID;
  if (!clubIdEnv) {
    return NextResponse.json({ error: "DUPR_GROUP_ID not configured" }, { status: 500 });
  }
  const clubId = Number(clubIdEnv);

  const { data: matchesRaw } = await admin
    .from("matches")
    .select("*")
    .eq("tournament_id", id)
    .eq("status", "validated");
  const matches = (matchesRaw ?? []) as Match[];

  if (matches.length === 0) {
    return NextResponse.json({ error: "No validated matches to upload" }, { status: 409 });
  }

  const userIds = await collectMatchUserIds(admin, matches);

  // Exclude non-playing admins from the DUPR submission
  const { data: nonPlayingAdmins } = await admin
    .from("tournament_admins")
    .select("user_id")
    .eq("tournament_id", id)
    .eq("is_playing", false);
  const nonPlayingIds = new Set((nonPlayingAdmins ?? []).map((a: any) => a.user_id));
  for (const uid of nonPlayingIds) userIds.delete(uid);

  const profiles = await fetchProfiles(admin, Array.from(userIds));

  // VALIDATION GATE 1 — every player has dupr_id in our profile.
  const missing: Pick<Profile, "id" | "first_name" | "last_name" | "email">[] = [];
  for (const uid of userIds) {
    const p = profiles.get(uid);
    if (!p) continue;
    if (!p.dupr_id || p.dupr_id.trim() === "") {
      missing.push({ id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email });
    }
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, reason: "missing_dupr_ids", missing },
      { status: 409 }
    );
  }

  // Resolve dupr_id text → numeric id via player search (no club membership required).
  const duprCodes = Array.from(userIds)
    .map((uid) => profiles.get(uid)?.dupr_id)
    .filter((s): s is string => !!s);

  let numericMap: Map<string, number>;
  try {
    numericMap = await resolveDuprNumericIdsBySearch(duprCodes);
  } catch (err) {
    const e = err as DuprError;
    return NextResponse.json(
      { ok: false, reason: "dupr_login_failed", status: e.status, body: e.body },
      { status: 502 }
    );
  }

  // All gated. Submit each match.
  const resolved = await resolveMatchPlayers(admin, matches, profiles);

  type MatchDescriptor = {
    matchId: string;
    teamALabel: string;
    teamBLabel: string;
    scoreA: number;
    scoreB: number;
  };
  type FailedMatch = MatchDescriptor & {
    status: number;
    reason: string;
    rawMessage: string | null;
  };

  function labelTeam(side: { profile: { first_name: string | null; last_name: string | null; email: string } }[]) {
    return side
      .map((p) => `${p.profile.first_name ?? ""} ${p.profile.last_name ?? ""}`.trim() || p.profile.email)
      .join(" / ");
  }

  function friendlyReason(status: number, body: unknown): { reason: string; rawMessage: string | null } {
    const msg = typeof body === "object" && body && "message" in body ? String((body as any).message) : null;
    if (status === 0 && typeof body === "string") return { reason: body, rawMessage: body };
    if (msg) {
      const lower = msg.toLowerCase();
      if (lower.includes("draw")) return { reason: "Score is a tie. DUPR requires a winner. Edit the match score and re-upload.", rawMessage: msg };
      if (lower.includes("email or password")) return { reason: "DUPR login rejected. Check DUPR_EMAIL / DUPR_PASSWORD in server config.", rawMessage: msg };
      if (lower.includes("player") && lower.includes("found")) return { reason: "DUPR could not find one of the players. Check DUPR IDs.", rawMessage: msg };
      if (lower.includes("club")) return { reason: "Player not in the DUPR club. Add them to club 7006521965.", rawMessage: msg };
      return { reason: msg, rawMessage: msg };
    }
    return { reason: `DUPR returned ${status}`, rawMessage: null };
  }

  const submitted: MatchDescriptor[] = [];
  const failed: FailedMatch[] = [];

  for (const r of resolved) {
    const descriptor: MatchDescriptor = {
      matchId: r.matchId,
      teamALabel: labelTeam(r.teamA) || "(unknown)",
      teamBLabel: labelTeam(r.teamB) || "(unknown)",
      scoreA: r.scoreA,
      scoreB: r.scoreB,
    };

    if (r.teamA.length === 0 || r.teamB.length === 0) {
      failed.push({ ...descriptor, status: 0, reason: "Missing players on one side", rawMessage: null });
      continue;
    }

    const t1Ids = r.teamA.map((p) => numericMap.get(p.duprId!)).filter((n): n is number => !!n);
    const t2Ids = r.teamB.map((p) => numericMap.get(p.duprId!)).filter((n): n is number => !!n);
    if (t1Ids.length === 0 || t2Ids.length === 0) {
      failed.push({ ...descriptor, status: 0, reason: "Could not resolve DUPR numeric IDs", rawMessage: null });
      continue;
    }

    const team1Won = r.scoreA > r.scoreB;
    const payload: DuprMatchPayload = {
      eventDate: r.updatedAt.slice(0, 10),
      format: r.format === "doubles" ? "DOUBLES" : "SINGLES",
      matchType: "SIDE_ONLY",
      notify: false,
      metadata: { source: "picktennt", tournamentId: id },
      event: `Picktennt — ${tournament.name}`,
      clubId,
      team1: {
        player1: t1Ids[0],
        ...(t1Ids[1] ? { player2: t1Ids[1] } : {}),
        game1: r.scoreA,
        winner: team1Won,
      },
      team2: {
        player1: t2Ids[0],
        ...(t2Ids[1] ? { player2: t2Ids[1] } : {}),
        game1: r.scoreB,
        winner: !team1Won,
      },
      scores: [{ first: r.scoreA, second: r.scoreB }],
    };

    try {
      const res = await submitDuprMatch(clubId, payload);
      if (res.ok) {
        submitted.push(descriptor);
      } else {
        const friendly = friendlyReason(res.status, res.body);
        failed.push({ ...descriptor, status: res.status, ...friendly });
      }
    } catch (err) {
      const e = err as DuprError;
      const friendly = friendlyReason(e.status ?? 500, e.body);
      failed.push({ ...descriptor, status: e.status ?? 500, ...friendly });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    submittedCount: submitted.length,
    failedCount: failed.length,
    submitted,
    failed,
  });
}
