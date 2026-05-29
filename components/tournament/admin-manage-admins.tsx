"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { getInitials } from "@/lib/utils";
import { Shield, Search, X, Trash2 } from "lucide-react";
import type { TournamentAdmin, Profile } from "@/types/database";

interface Props {
  tournamentId: string;
  admins: (TournamentAdmin & { profile: Profile })[];
  currentUserId: string;
}

interface ProfileResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
}

export function AdminManageAdmins({ tournamentId, admins, currentUserId }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const existingAdminIds = admins.map((a) => a.user_id);

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
          .not("id", "in", `(${existingAdminIds.join(",") || "00000000-0000-0000-0000-000000000000"})`)
          .limit(8);
        setResults((data ?? []) as ProfileResult[]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function addAdmin(profile: ProfileResult) {
    setAdding(profile.id);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: profile.id, is_playing: isPlaying }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast(`${profile.first_name ?? profile.email} added as admin!`, "success");
      setResults((r) => r.filter((p) => p.id !== profile.id));
      setQuery("");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to add admin", "error");
    } finally {
      setAdding(null);
    }
  }

  async function removeAdmin(adminId: string) {
    setRemoving(adminId);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/admins`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_id: adminId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("Admin removed", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to remove admin", "error");
    } finally {
      setRemoving(null);
    }
  }

  async function togglePlaying(adminId: string, newValue: boolean) {
    setToggling(adminId);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/admins`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_id: adminId, is_playing: newValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to update", "error");
    } finally {
      setToggling(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-brand-500" />
          Administrators
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing admins */}
        <div className="space-y-2">
          {admins.map((a) => {
            const profile = a.profile;
            const isPrimary = a.succession_order === 1;
            return (
              <div key={a.id} className="flex items-center gap-3 py-1">
                <div className="w-6 text-xs font-bold text-gray-400">#{a.succession_order}</div>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={profile?.avatar_url ?? ""} />
                  <AvatarFallback className="text-xs">{getInitials(profile?.first_name, profile?.last_name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {profile?.first_name} {profile?.last_name}
                    {isPrimary && <span className="ml-2 text-xs text-brand-500">Primary</span>}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{profile?.email}</div>
                </div>
                <button
                  onClick={() => togglePlaying(a.id, !a.is_playing)}
                  disabled={toggling === a.id}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                    a.is_playing
                      ? "bg-green-50 text-green-700 hover:bg-green-100"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {a.is_playing ? "Playing" : "Not playing"}
                </button>
                {!isPrimary && a.user_id !== currentUserId && (
                  <button
                    onClick={() => removeAdmin(a.id)}
                    disabled={removing === a.id}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add co-admin */}
        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add Co-Admin</p>
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

          {/* Playing toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={isPlaying}
              onChange={(e) => setIsPlaying(e.target.checked)}
              className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            Admin will also play in the tournament
          </label>

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
                  <Button size="sm" loading={adding === p.id} onClick={() => addAdmin(p)}>
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}

          {query && !searching && results.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">No users found</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
