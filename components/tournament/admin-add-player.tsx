"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { getInitials } from "@/lib/utils";
import { UserPlus, Search, X, Users, ArrowLeft } from "lucide-react";
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

interface SoloTeam {
  id: string;
  memberName: string;
  memberAvatar: string | null;
}

export function AdminAddPlayer({ tournament, existingPlayerIds }: Props) {
  const isDoubles = tournament.type === "doubles";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [searching, setSearching] = useState(false);

  // doubles-only 2-step flow
  const [pendingPlayer, setPendingPlayer] = useState<ProfileResult | null>(null);
  const [soloTeams, setSoloTeams] = useState<SoloTeam[]>([]);
  const [teamChoice, setTeamChoice] = useState<"new" | string>("new");
  const [loadingTeams, setLoadingTeams] = useState(false);

  const [adding, setAdding] = useState(false);
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

  async function pickPlayer(profile: ProfileResult) {
    if (!isDoubles) {
      await addPlayer(profile, null);
      return;
    }

    // Doubles: load available solo teams (< 2 members) before showing step 2
    setLoadingTeams(true);
    try {
      const supabase = createClient();
      const { data: teams } = await supabase
        .from("teams")
        .select("id, team_members(user_id, profile:profiles(first_name, last_name, avatar_url))")
        .eq("tournament_id", tournament.id);

      const solo: SoloTeam[] = ((teams ?? []) as any[])
        .filter((t) => (t.team_members ?? []).length === 1)
        .map((t) => {
          const m = t.team_members[0];
          const name = [`${m.profile?.first_name ?? ""}`, `${m.profile?.last_name ?? ""}`]
            .join(" ").trim() || "Unknown";
          return { id: t.id, memberName: name, memberAvatar: m.profile?.avatar_url ?? null };
        });

      setSoloTeams(solo);
      setTeamChoice("new");
      setPendingPlayer(profile);
    } catch (err: any) {
      toast(err.message ?? "Failed to load teams", "error");
    } finally {
      setLoadingTeams(false);
    }
  }

  async function confirmAdd() {
    if (!pendingPlayer) return;
    await addPlayer(pendingPlayer, teamChoice === "new" ? null : teamChoice);
  }

  async function addPlayer(profile: ProfileResult, existingTeamId: string | null) {
    setAdding(true);
    try {
      const supabase = createClient();

      const { error: playerErr } = await supabase.from("tournament_players").insert({
        tournament_id: tournament.id,
        user_id: profile.id,
        status: "approved",
        joined_via: "invite",
      });
      if (playerErr) throw playerErr;

      if (tournament.type !== "mixed") {
        if (existingTeamId) {
          const { error: memberErr } = await supabase
            .from("team_members")
            .insert({ team_id: existingTeamId, user_id: profile.id });
          if (memberErr) throw memberErr;
        } else {
          const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email;
          const { data: team, error: teamErr } = await supabase
            .from("teams")
            .insert({ tournament_id: tournament.id, name })
            .select()
            .single();
          if (teamErr) throw teamErr;
          const { error: memberErr } = await supabase
            .from("team_members")
            .insert({ team_id: team.id, user_id: profile.id });
          if (memberErr) throw memberErr;
        }
      }

      const displayName = profile.first_name ?? profile.email;
      const msg = isDoubles && existingTeamId
        ? `${displayName} added and paired with ${soloTeams.find((t) => t.id === existingTeamId)?.memberName ?? "partner"}!`
        : `${displayName} added!`;
      toast(msg, "success");
      resetForm();
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to add player", "error");
    } finally {
      setAdding(false);
    }
  }

  function resetForm() {
    setPendingPlayer(null);
    setSoloTeams([]);
    setTeamChoice("new");
    setResults([]);
    setQuery("");
  }

  // ── Step 2 (doubles): team assignment UI ────────────────────────────────
  if (pendingPlayer) {
    const name = [pendingPlayer.first_name, pendingPlayer.last_name].filter(Boolean).join(" ") || pendingPlayer.email;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-brand-500" />
            Assign Team for {name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">
            Choose a team for this player. They can form a new solo team (waiting for a partner) or be paired directly.
          </p>

          {/* New solo team option */}
          <button
            type="button"
            onClick={() => setTeamChoice("new")}
            className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
              teamChoice === "new" ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="font-semibold text-sm text-gray-900">New solo team</div>
            <div className="text-xs text-gray-500 mt-0.5">Looking for partner — team will be incomplete until paired</div>
          </button>

          {/* Existing solo teams */}
          {soloTeams.length > 0 && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Or partner with:</p>
              {soloTeams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeamChoice(t.id)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-colors flex items-center gap-3 ${
                    teamChoice === t.id ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarImage src={t.memberAvatar ?? ""} />
                    <AvatarFallback className="text-xs">{getInitials(t.memberName.split(" ")[0], t.memberName.split(" ")[1])}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-sm text-gray-900">{t.memberName}</div>
                    <div className="text-xs text-gray-400">Solo — needs a partner</div>
                  </div>
                </button>
              ))}
            </>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={resetForm} className="flex-1">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button onClick={confirmAdd} loading={adding} className="flex-1">
              Add Player
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 1: search UI ────────────────────────────────────────────────────
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

        {(searching || loadingTeams) && (
          <p className="text-xs text-gray-400 text-center py-2">Searching…</p>
        )}

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
                <Button
                  size="sm"
                  loading={loadingTeams}
                  onClick={() => pickPlayer(p)}
                >
                  {isDoubles ? "Select" : "Add"}
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
