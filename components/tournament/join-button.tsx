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
}

export function JoinButton({ tournamentId, userId, pendingRowId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function join() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("tournament_players").insert({
        tournament_id: tournamentId,
        user_id: userId,
        status: "pending",
        joined_via: "link",
      });
      if (error) throw error;
      toast("Join request sent! Waiting for admin approval.", "success");
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
      Request to Join
    </Button>
  );
}
