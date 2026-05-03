"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { getInitials } from "@/lib/utils";
import { Users } from "lucide-react";

export interface AvailableTeam {
  id: string;
  name: string | null;
  members: { user_id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }[];
}

interface Props {
  tournamentId: string;
  userId: string;
  availableTeams: AvailableTeam[]; // teams with < 2 members
}

export function TeamPicker({ tournamentId, userId, availableTeams }: Props) {
  const [choice, setChoice] = useState<"new" | string>("new");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function confirm() {
    setLoading(true);
    try {
      const supabase = createClient();

      if (choice === "new") {
        // Fetch user profile for team name
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("id", userId)
          .single();
        const name = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
          : "Player";
        const { data: team, error: teamErr } = await supabase
          .from("teams")
          .insert({ tournament_id: tournamentId, name })
          .select()
          .single();
        if (teamErr) throw teamErr;
        const { error: memberErr } = await supabase
          .from("team_members")
          .insert({ team_id: team.id, user_id: userId });
        if (memberErr) throw memberErr;
        toast("New team created! Waiting for a partner.", "success");
      } else {
        // Join existing team
        const { error } = await supabase
          .from("team_members")
          .insert({ team_id: choice, user_id: userId });
        if (error) throw error;
        const teamName = availableTeams.find((t) => t.id === choice)?.members[0]
          ? `${availableTeams.find((t) => t.id === choice)!.members[0].first_name ?? ""} ${availableTeams.find((t) => t.id === choice)!.members[0].last_name ?? ""}`.trim()
          : "your partner";
        toast(`Paired with ${teamName}!`, "success");
      }

      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to join team", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        You&apos;re in! Choose your team to complete your registration.
      </p>

      {/* Create new solo team */}
      <button
        type="button"
        onClick={() => setChoice("new")}
        className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
          choice === "new" ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <div className="font-semibold text-sm text-gray-900">Create new team slot</div>
        <div className="text-xs text-gray-500 mt-0.5">Solo for now — looking for a partner</div>
      </button>

      {/* Join an existing solo team */}
      {availableTeams.filter((t) => t.members.length > 0).length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Or join someone&apos;s team:</p>
          {availableTeams.filter((t) => t.members.length > 0).map((team) => {
            const m = team.members[0];
            const name = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Player";
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => setChoice(team.id)}
                className={`w-full text-left p-3 rounded-xl border-2 transition-colors flex items-center gap-3 ${
                  choice === team.id ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={m.avatar_url ?? ""} />
                  <AvatarFallback className="text-xs">{getInitials(m.first_name, m.last_name)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-sm text-gray-900">{name}</div>
                  <div className="text-xs text-gray-400">Looking for a partner</div>
                </div>
              </button>
            );
          })}
        </>
      )}

      {availableTeams.length === 0 && (
        <p className="text-xs text-gray-400">No open team slots right now. You&apos;ll create a new one.</p>
      )}

      <Button onClick={confirm} loading={loading} className="w-full">
        <Users className="h-4 w-4" />
        Confirm Team
      </Button>
    </div>
  );
}
