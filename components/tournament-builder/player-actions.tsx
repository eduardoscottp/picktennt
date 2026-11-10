"use client";

import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import { individualRoster } from "@/lib/tournament-builder/individual-roster";
import { Button } from "@/components/ui/button";
import { PlayerReplacement } from "./player-replacement";
import { PlayerWithdrawal } from "./player-withdrawal";

export function PlayerActions({ snapshot, team, member, disabled, run }: { snapshot: CommandSnapshot; team: StorageRow; member: StorageRow; disabled: boolean; run: (command: string, data: Record<string, unknown>) => Promise<void> }) {
  const state = String(snapshot.event?.modular_state);
  const locked = !individualRoster(snapshot)?.editable;
  if (!["registration_open", "registration_closed", "ready", "active"].includes(state)) return null;
  async function remove(releaseOnly: boolean) {
    if (!window.confirm(releaseOnly ? "Free this player's position? They will remain registered in the tournament." : "Remove this player from the tournament? Their teammate will remain registered.")) return;
    await run("removeRegisteredPlayer", { user_id: member.user_id, release_only: releaseOnly });
  }
  return <details className="mt-1 rounded-lg border border-gray-200 p-2"><summary className="cursor-pointer text-xs font-semibold">Edit player <span className="sr-only">{String(member.display_name ?? "Player")}</span></summary><div className="mt-2 space-y-2">
    {!locked && <><Button size="sm" variant="outline" disabled={disabled} onClick={() => void remove(true)}>Free position</Button><Button size="sm" variant="outline" disabled={disabled} onClick={() => void remove(false)}>Remove player</Button></>}
    {locked && ["registration_open", "registration_closed", "ready"].includes(state) && <details><summary className="cursor-pointer text-xs">Remove player</summary><PlayerWithdrawal snapshot={snapshot} disabled={disabled} run={run} player={{ teamId: team.id, userId: String(member.user_id) }} /></details>}
    {locked && <p className="text-xs text-gray-500">Freeing a position while keeping the player registered is only available before the roster locks.</p>}
    {team.entry_state === "approved" && <details><summary className="cursor-pointer text-xs">Replace or edit player in this position</summary><PlayerReplacement snapshot={snapshot} disabled={disabled} run={run} player={{ teamId: team.id, userId: String(member.user_id) }} /></details>}
  </div></details>;
}
