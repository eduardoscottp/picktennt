"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { getInitials } from "@/lib/utils";
import { UserPlus, Search, X } from "lucide-react";
import type { Tournament } from "@/types/database";

interface Props {
  tournament: Tournament;
  existingPlayerIds: string[];
}

interface ProfileResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
}

export function AdminAddPlayer({ tournament, existingPlayerIds }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function search(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, avatar_url")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
          .not("id", "in", `(${existingPlayerIds.join(",") || "00000000-0000-0000-0000-000000000000"})`)
          .limit(8);
        setResults((data ?? []) as ProfileResult[]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function addPlayer(profile: ProfileResult) {
    setAdding(profile.id);
    try {
      const supabase = createClient();

      const { error: playerErr } = await supabase.from("tournament_players").insert({
        tournament_id: tournament.id,
        user_id: profile.id,
        status: "approved",
        joined_via: "invite",
      });
      if (playerErr) throw playerErr;

      // Singles: auto-create a team for the player
      if (tournament.type === "singles") {
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email;
        const { data: team, error: teamErr } = await supabase
          .from("teams")
          .insert({ tournament_id: tournament.id, name })
          .select()
          .single();
        if (teamErr) throw teamErr;
        await supabase.from("team_members").insert({ team_id: team.id, user_id: profile.id });
      }

      toast(`${profile.first_name ?? profile.email} added!`, "success");
      setResults((r) => r.filter((p) => p.id !== profile.id));
      setQuery("");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to add player", "error");
    } finally {
      setAdding(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-brand-500" />
          Add Player
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {searching && <p className="text-xs text-gray-400 text-center py-2">Searching…</p>}

        {results.length > 0 && (
          <div className="space-y-1">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2 px-1 rounded-xl hover:bg-gray-50">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={p.avatar_url ?? ""} />
                  <AvatarFallback className="text-xs">{getInitials(p.first_name, p.last_name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {p.first_name} {p.last_name}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{p.email}</div>
                </div>
                <Button size="sm" loading={adding === p.id} onClick={() => addPlayer(p)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}

        {query && !searching && results.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2">No users found</p>
        )}
      </CardContent>
    </Card>
  );
}
