"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { generateAndSaveSchedule } from "@/lib/tournament/schedule";
import type { Tournament, TournamentStatus } from "@/types/database";

const TRANSITIONS: Record<TournamentStatus, { label: string; next: TournamentStatus } | null> = {
  draft:        { label: "Open Registration",  next: "registration" },
  registration: { label: "Start Tournament",   next: "active" },
  active:       { label: "Start Finals",       next: "finals" },
  finals:       { label: "Complete Tournament", next: "completed" },
  completed:    null,
};

export function AdminStatusActions({ tournament }: { tournament: Tournament }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const transition = TRANSITIONS[tournament.status];
  if (!transition) return <p className="text-sm text-green-600 font-semibold">Tournament completed 🏆</p>;

  async function advance() {
    setLoading(true);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("tournaments")
        .update({ status: transition!.next })
        .eq("id", tournament.id);
      if (error) throw error;

      // Auto-generate the full round-robin schedule when the tournament goes active
      if (transition!.next === "active") {
        try {
          const count = await generateAndSaveSchedule(supabase, tournament);
          toast(`Tournament started! ${count} rounds generated.`, "success");
        } catch (schedErr: any) {
          toast(`Tournament started, but schedule generation failed: ${schedErr.message}`, "error");
        }
      } else {
        toast(`Status updated to "${transition!.next}"`, "success");
      }

      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={advance} loading={loading} className="w-full">
      {transition.label}
      {transition.next === "active" ? " & Generate Schedule" : ""}
    </Button>
  );
}
