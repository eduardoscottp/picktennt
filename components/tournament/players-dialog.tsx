"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { getInitials, duprRatingColor } from "@/lib/utils";
import type { Profile } from "@/types/database";

interface Player {
  id: string;
  profile: Profile;
}

export function PlayersDialog({
  players,
  maxPlayers,
}: {
  players: Player[];
  maxPlayers: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Users className="h-4 w-4" />
        Players ({players.length}/{maxPlayers})
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Players — {players.length} / {maxPlayers}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {players.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 py-1.5">
                <span className="text-xs text-gray-400 w-5 text-right font-mono">{i + 1}</span>
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={p.profile.avatar_url ?? ""} />
                  <AvatarFallback className="text-xs">
                    {getInitials(p.profile.first_name, p.profile.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {p.profile.first_name} {p.profile.last_name}
                  </div>
                </div>
                {p.profile.dupr_rating && (
                  <span className={`text-xs font-bold flex-shrink-0 ${duprRatingColor(p.profile.dupr_rating)}`}>
                    {p.profile.dupr_rating.toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
