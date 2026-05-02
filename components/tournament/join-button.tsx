"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function JoinButton({ tournamentId, userId }: { tournamentId: string; userId: string }) {
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

  return (
    <Button onClick={join} loading={loading} className="w-full">
      Request to Join
    </Button>
  );
}
