"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { getInitials } from "@/lib/utils";
import { Plus, X, Search, Users } from "lucide-react";

export interface TeamMemberData {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface TeamData {
  id: string;
  name: string | null;
  members: TeamMemberData[];
}

interface Props {
  tournamentId: string;
  teams: TeamData[];
  isAdmin: boolean;
  currentUserId: string | null;
  myTeamId: string | null;
  isApprovedPlayer: boolean;
  existingMemberIds: string[];
  readonly?: boolean;
}

interface ProfileResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
}

export function DoublesTeamGrid({
  tournamentId,
  teams,
  isAdmin,
  currentUserId,
  myTeamId,
  isApprovedPlayer,
  existingMemberIds,
  readonly = false,
}: Props) {
  const [activeSlot, setActiveSlot] = useState<{ teamId: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null); // userId being assigned
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  function openSearch(teamId: string) {
    setActiveSlot({ teamId });
    setSearchQuery("");
    setSearchResults([]);
  }

  function closeSearch() {
    setActiveSlot(null);
    setSearchQuery("");
    setSearchResults([]);
  }

  async function search(q: string) {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setSearchResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const supabase = createClient();
        const exclude = existingMemberIds.length > 0
          ? existingMemberIds
          : ["00000000-0000-0000-0000-000000000000"];
        const { data } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, avatar_url")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
          .not("id", "in", `(${exclude.join(",")})`)
          .limit(8);
        setSearchResults((data ?? []) as ProfileResult[]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function adminAssign(profile: ProfileResult) {
    if (!activeSlot) return;
    setAssigning(profile.id);
    try {
      const supabase = createClient();

      // Add to tournament_players if not already in (ignore unique conflict)
      const { error: tpErr } = await supabase.from("tournament_players").insert({
        tournament_id: tournamentId,
        user_id: profile.id,
        status: "approved",
        joined_via: "invite",
      });
      if (tpErr && tpErr.code !== "23505") throw tpErr;

      // If they were pending, promote to approved
      if (tpErr?.code === "23505") {
        await supabase
          .from("tournament_players")
          .update({ status: "approved" })
          .eq("tournament_id", tournamentId)
          .eq("user_id", profile.id)
          .eq("status", "pending");
      }

      const { error: tmErr } = await supabase
        .from("team_members")
        .insert({ team_id: activeSlot.teamId, user_id: profile.id });
      if (tmErr) throw tmErr;

      const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email;
      toast(`${name} added to team!`, "success");
      closeSearch();
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to assign player", "error");
    } finally {
      setAssigning(null);
    }
  }

  async function selfAssign(teamId: string) {
    if (!currentUserId) return;
    setAssigning(currentUserId);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("team_members")
        .insert({ team_id: teamId, user_id: currentUserId });
      if (error) throw error;
      toast("You joined the team!", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to join team", "error");
    } finally {
      setAssigning(null);
    }
  }

  async function removeFromSlot(teamId: string, userId: string) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("team_id", teamId)
        .eq("user_id", userId);
      if (error) throw error;
      toast("Player removed from slot.", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to remove player", "error");
    }
  }

  const canSelfAssign = isApprovedPlayer && !myTeamId && !!currentUserId && !readonly;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {teams.map((team, idx) => {
          const isFull = team.members.length >= 2;
          return (
            <Card key={team.id} className={`overflow-hidden ${isFull ? "border-green-200" : ""}`}>
              <CardHeader className={`py-2 px-3 border-b ${isFull ? "bg-green-50" : "bg-brand-50"}`}>
                <CardTitle className={`text-xs font-bold flex items-center gap-1.5 ${isFull ? "text-green-700" : "text-brand-700"}`}>
                  <Users className="h-3 w-3" />
                  {team.name ?? `Team ${idx + 1}`}
                  {isFull && <span className="ml-auto text-[10px] font-semibold bg-green-100 text-green-700 rounded-full px-1.5 py-0.5">Ready</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2.5 space-y-1.5">
                {[0, 1].map((slotIdx) => {
                  const member = team.members[slotIdx] ?? null;
                  const isMySlot = member?.user_id === currentUserId;

                  if (member) {
                    return (
                      <div key={slotIdx} className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5">
                        <Avatar className="h-6 w-6 flex-shrink-0">
                          <AvatarImage src={member.avatar_url ?? ""} />
                          <AvatarFallback className="text-[9px]">{getInitials(member.first_name, member.last_name)}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs font-medium text-gray-900 flex-1 truncate">
                          {member.first_name} {member.last_name}
                          {isMySlot && <span className="ml-1 text-brand-500">(you)</span>}
                        </span>
                        {isAdmin && !readonly && (
                          <button
                            onClick={() => removeFromSlot(team.id, member.user_id)}
                            className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                            title="Remove player"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  }

                  // Empty slot — admin
                  if (isAdmin && !readonly) {
                    return (
                      <button
                        key={slotIdx}
                        onClick={() => openSearch(team.id)}
                        className="w-full flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-2 py-1.5 hover:border-brand-400 hover:bg-brand-50 transition-colors group"
                      >
                        <div className="h-6 w-6 rounded-full border-2 border-dashed border-gray-300 group-hover:border-brand-400 flex items-center justify-center flex-shrink-0">
                          <Plus className="h-3 w-3 text-gray-400 group-hover:text-brand-500" />
                        </div>
                        <span className="text-xs text-gray-400 group-hover:text-brand-500">Add player</span>
                      </button>
                    );
                  }

                  // Empty slot — approved player without a team
                  if (canSelfAssign) {
                    return (
                      <button
                        key={slotIdx}
                        onClick={() => selfAssign(team.id)}
                        disabled={assigning === currentUserId}
                        className="w-full flex items-center gap-2 rounded-lg border-2 border-dashed border-brand-300 px-2 py-1.5 hover:border-brand-500 hover:bg-brand-50 transition-colors group disabled:opacity-50"
                      >
                        <div className="h-6 w-6 rounded-full border-2 border-brand-300 group-hover:border-brand-500 flex items-center justify-center flex-shrink-0">
                          <Plus className="h-3 w-3 text-brand-400 group-hover:text-brand-600" />
                        </div>
                        <span className="text-xs text-brand-500 font-medium">Join this spot</span>
                      </button>
                    );
                  }

                  // Empty slot — read-only
                  return (
                    <div key={slotIdx} className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-2 py-1.5 opacity-40">
                      <div className="h-6 w-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-3 w-3 text-gray-300" />
                      </div>
                      <span className="text-xs text-gray-300">Open</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Admin player search modal */}
      <Dialog open={!!activeSlot} onOpenChange={(open) => { if (!open) closeSearch(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Player to Slot</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => search(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full h-10 rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {searching && <p className="text-xs text-gray-400 text-center py-2">Searching…</p>}

            {searchResults.length > 0 && (
              <div className="space-y-1">
                {searchResults.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 px-1 rounded-xl hover:bg-gray-50">
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
                      loading={assigning === p.id}
                      onClick={() => adminAssign(p)}
                    >
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {searchQuery && !searching && searchResults.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">No users found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
