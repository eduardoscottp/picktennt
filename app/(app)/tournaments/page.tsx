import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate, statusLabel, tournamentTypeLabel } from "@/lib/utils";
import type { Tournament } from "@/types/database";

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("tournaments")
    .select("*")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(50);

  if (q) query = query.ilike("name", `%${q}%`);

  const { data: tournaments } = await query;

  const statusVariant = (s: string) => {
    if (s === "active" || s === "finals") return "success";
    if (s === "completed") return "secondary";
    if (s === "registration") return "default";
    return "secondary";
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <h1 className="text-2xl font-black text-gray-900">Browse Tournaments</h1>

      <form method="GET">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search tournaments..."
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </form>

      {(tournaments ?? []).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-semibold">No tournaments found</p>
          <p className="text-sm mt-1">Try a different search or create your own</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(tournaments ?? []).map((t: Tournament) => (
            <Link key={t.id} href={`/tournaments/${t.id}`}>
              <Card className="hover:border-brand-200 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 truncate">{t.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {tournamentTypeLabel(t.type)} · {t.max_players} players · {t.court_count} courts · {formatDate(t.created_at)}
                    </div>
                  </div>
                  <Badge variant={statusVariant(t.status) as any}>
                    {statusLabel(t.status)}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
