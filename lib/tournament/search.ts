import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID } from "@/lib/tournament-builder/requests";
import type { Tournament } from "@/types/database";

type Listing = Tournament & { engine_version?: string; modular_state?: string };
type Result = { tournament: Tournament; href: string };

export async function searchTournaments(
  db: SupabaseClient,
  input: string | undefined,
  adminClient?: () => Promise<SupabaseClient>,
): Promise<Result[]> {
  const term = input?.trim() ?? "";
  const isId = UUID.test(term);
  const isCode = /^[0-9a-f]{8}$/i.test(term);
  let query = db.from("tournaments").select("*").order("created_at", { ascending: false }).limit(50);
  if (term) query = isId ? query.eq("id", term) : query.ilike("name", `%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error("Could not load tournaments. Please try again.");
  const visible = (data ?? []) as Listing[];
  const results = visible.map(tournament => ({ tournament, href: `/tournaments/${tournament.id}` }));
  if (!adminClient || (!isId && !isCode) || (isId && visible.length)) {
    return results;
  }

  // Exact IDs and join codes grant access to published unlisted tournaments, not to drafts.
  const admin = await adminClient();
  const result = await admin.from("tournaments")
    .select("id,name,type,status,max_players,court_count,tournament_date,created_at,is_public,join_code,engine_version,modular_state")
    .eq(isId ? "id" : "join_code", isId ? term : term.toUpperCase()).maybeSingle();
  if (result.error) throw new Error("Could not load tournaments. Please try again.");
  const tournament = result.data as Listing | null;
  if (!tournament || tournament.status === "draft" || tournament.modular_state === "draft") return results;
  const href = tournament.engine_version === "modular_v1" || tournament.is_public
    ? `/tournaments/${tournament.id}` : `/join/${encodeURIComponent(tournament.join_code)}`;
  return [{ tournament, href }, ...results.filter(item => item.tournament.id !== tournament.id)];
}
