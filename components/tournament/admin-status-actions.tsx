"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AlertCircle } from "lucide-react";
import type { Tournament, TournamentStatus } from "@/types/database";

const TRANSITIONS: Record<TournamentStatus, { label: string; next: TournamentStatus } | null> = {
  draft:        { label: "Open Registration",  next: "registration" },
  registration: { label: "Start Tournament",   next: "active" },
  active:       { label: "Start Finals",       next: "finals" },
  finals:       { label: "Complete Tournament", next: "completed" },
  completed:    null,
};

interface Props {
  tournament: Tournament;
  hasExistingRounds?: boolean;
  allMatchesValidated?: boolean;
}

export function AdminStatusActions({ tournament, hasExistingRounds, allMatchesValidated }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const transition = TRANSITIONS[tournament.status];
  if (!transition) return <p className="text-sm text-green-600 font-semibold">Tournament completed 🏆</p>;

  // Gate: "Start Tournament" requires round robin to exist
  if (transition.next === "active" && hasExistingRounds === false) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>Generate the round robin schedule before starting the tournament.</span>
      </div>
    );
  }

  // Gate: "Complete Tournament" requires all matches validated
  if (transition.next === "completed" && allMatchesValidated === false) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>All match scores must be validated before completing the tournament.</span>
      </div>
    );
  }

  async function advance() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("tournaments")
        .update({ status: transition!.next })
        .eq("id", tournament.id);
      if (error) throw error;
      toast(`Status updated to "${transition!.next}"`, "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={advance} loading={loading} className="w-full">
      {transition.label}
    </Button>
  );
}
