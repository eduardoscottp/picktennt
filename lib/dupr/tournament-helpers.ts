/**
 * Helpers to extract player IDs from tournament matches and resolve DUPR IDs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match, Profile } from "@/types/database";

export interface MatchPlayerResolution {
  matchId: string;
  format: "singles" | "doubles";
  teamA: { userId: string; duprId: string | null; profile: Profile }[];
  teamB: { userId: string; duprId: string | null; profile: Profile }[];
  scoreA: number;
  scoreB: number;
  updatedAt: string;
}

/** Collect distinct user IDs from a list of matches, resolving teams via team_members. */
export async function collectMatchUserIds(
  admin: SupabaseClient,
  matches: Match[]
): Promise<Set<string>> {
  const directIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const m of matches) {
    for (const id of [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id]) {
      if (id) directIds.add(id);
    }
    if (m.team_a_id) teamIds.add(m.team_a_id);
    if (m.team_b_id) teamIds.add(m.team_b_id);
  }

  if (teamIds.size > 0) {
    const { data: members } = await admin
      .from("team_members")
      .select("user_id, team_id")
      .in("team_id", Array.from(teamIds));
    for (const row of members ?? []) {
      if (row.user_id) directIds.add(row.user_id);
    }
  }

  return directIds;
}

/** Fetch profiles by ids. */
export async function fetchProfiles(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, Profile>> {
  if (userIds.length === 0) return new Map();
  const { data } = await admin
    .from("profiles")
    .select("*")
    .in("id", userIds);
  const m = new Map<string, Profile>();
  for (const p of (data ?? []) as Profile[]) m.set(p.id, p);
  return m;
}

/** Build per-match player resolution including DUPR IDs from a profile map and team members. */
export async function resolveMatchPlayers(
  admin: SupabaseClient,
  matches: Match[],
  profiles: Map<string, Profile>
): Promise<MatchPlayerResolution[]> {
  const teamIds = new Set<string>();
  for (const m of matches) {
    if (m.team_a_id) teamIds.add(m.team_a_id);
    if (m.team_b_id) teamIds.add(m.team_b_id);
  }

  const teamMembers = new Map<string, string[]>();
  if (teamIds.size > 0) {
    const { data: rows } = await admin
      .from("team_members")
      .select("team_id, user_id")
      .in("team_id", Array.from(teamIds));
    for (const r of rows ?? []) {
      const arr = teamMembers.get(r.team_id) ?? [];
      arr.push(r.user_id);
      teamMembers.set(r.team_id, arr);
    }
  }

  const result: MatchPlayerResolution[] = [];
  for (const m of matches) {
    const aIds: string[] = [];
    const bIds: string[] = [];

    if (m.team_a_id) aIds.push(...(teamMembers.get(m.team_a_id) ?? []));
    if (m.team_b_id) bIds.push(...(teamMembers.get(m.team_b_id) ?? []));
    for (const id of [m.player_a1_id, m.player_a2_id]) if (id) aIds.push(id);
    for (const id of [m.player_b1_id, m.player_b2_id]) if (id) bIds.push(id);

    const uniqA = Array.from(new Set(aIds));
    const uniqB = Array.from(new Set(bIds));

    const teamA = uniqA
      .map((id) => profiles.get(id))
      .filter((p): p is Profile => !!p)
      .map((p) => ({ userId: p.id, duprId: p.dupr_id, profile: p }));
    const teamB = uniqB
      .map((id) => profiles.get(id))
      .filter((p): p is Profile => !!p)
      .map((p) => ({ userId: p.id, duprId: p.dupr_id, profile: p }));

    const sideSize = Math.max(teamA.length, teamB.length);
    const format: "singles" | "doubles" = sideSize >= 2 ? "doubles" : "singles";

    result.push({
      matchId: m.id,
      format,
      teamA,
      teamB,
      scoreA: m.score_a ?? 0,
      scoreB: m.score_b ?? 0,
      updatedAt: m.updated_at,
    });
  }

  return result;
}
