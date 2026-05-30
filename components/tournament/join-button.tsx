"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Clock, X } from "lucide-react";

interface Props {
  tournamentId: string;
  userId: string;
  pendingRowId?: string; // present when a request is pending — shows cancel state
  autoApprove?: boolean; // true when tournament is_open or user came via invitation link
  tournamentType?: "singles" | "doubles" | "mixed"; // needed to auto-create team for singles
}

export function JoinButton({ tournamentId, userId, pendingRowId, autoApprove, tournamentType }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function join() {
    setLoading(true);
    try {
      const supabase = createClient();
      const status = autoApprove ? "approved" : "pending";
      const { error } = await supabase.from("tournament_players").insert({
        tournament_id: tournamentId,
        user_id: userId,
        status,
        joined_via: "link",
      });
      if (error) {
        // Already exists — just refresh to show current state
        if (error.code === "23505") {
          router.refresh();
          return;
        }
        throw error;
      }

      // Singles auto-approve: create a team for the player
      if (autoApprove && tournamentType === "singles") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("id", userId)
          .single();
        const teamName = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
          : "Player";
        const { data: team, error: teamErr } = await supabase
          .from("teams")
          .insert({ tournament_id: tournamentId, name: teamName })
          .select()
          .single();
        if (!teamErr && team) {
          await supabase.from("team_members").insert({ team_id: team.id, user_id: userId });
        }
      }

      toast(
        autoApprove ? "You're in! Welcome to the tournament." : "Join request sent! Waiting for admin approval.",
        "success"
      );
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to join", "error");
    } finally {
      setLoading(false);
    }
  }

  async function cancelRequest() {
    if (!pendingRowId) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("tournament_players")
        .delete()
        .eq("id", pendingRowId);
      if (error) throw error;
      toast("Join request cancelled.", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to cancel request", "error");
    } finally {
      setLoading(false);
    }
  }

  if (pendingRowId) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 rounded-xl px-4 py-2 font-medium">
          <Clock className="h-4 w-4 flex-shrink-0" />
          Request pending approval
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={cancelRequest}
          loading={loading}
          className="flex-shrink-0 text-red-500 hover:text-red-600"
        >
          <X className="h-4 w-4" />
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={join} loading={loading} className="w-full">
      {autoApprove ? "Join Tournament" : "Request to Join"}
    </Button>
  );
}
