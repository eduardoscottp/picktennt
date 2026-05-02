"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Check, X, UserMinus } from "lucide-react";

export function AdminPlayerActions({
  tournamentPlayerId,
  status,
}: {
  tournamentPlayerId: string;
  status: "pending" | "approved";
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function updateStatus(newStatus: "approved" | "rejected") {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("tournament_players")
        .update({ status: newStatus })
        .eq("id", tournamentPlayerId);
      if (error) throw error;
      toast(newStatus === "approved" ? "Player approved" : "Player removed", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  if (status === "pending") {
    return (
      <div className="flex gap-1">
        <Button size="icon" onClick={() => updateStatus("approved")} loading={loading} className="h-8 w-8">
          <Check className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="danger" onClick={() => updateStatus("rejected")} loading={loading} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button size="icon" variant="ghost" onClick={() => updateStatus("rejected")} loading={loading} className="h-8 w-8 text-red-400">
      <UserMinus className="h-4 w-4" />
    </Button>
  );
}
