"use client";

import { useState } from "react";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import { ImpactReview } from "./impact-review";
import { TeamWithdrawal } from "./team-withdrawal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TeamActions({ snapshot, team, label, disabled, owner, matchLabel, run }: { snapshot: CommandSnapshot; team: StorageRow; label: (id: unknown) => string; disabled: boolean; owner: boolean; matchLabel: (id: string) => string; run: (command: string, data: Record<string, unknown>) => Promise<void> }) {
  const event = snapshot.event!;
  const state = String(event.modular_state);
  const [name, setName] = useState(label(team.id));
  const [reason, setReason] = useState("");
  return <details className="mt-2 rounded-lg border border-gray-200 p-2"><summary className="cursor-pointer text-xs font-semibold">Edit team</summary><div className="mt-2 space-y-3">
    {["registration_open", "registration_closed", "ready", "active", "completed"].includes(state) && <details><summary className="cursor-pointer text-xs">Rename team</summary><div className="space-y-2 pt-2"><Input id={"team-name-" + team.id} label="Team name" value={name} maxLength={120} onChange={event => setName(event.target.value)} /><Input id={"team-name-reason-" + team.id} label="Reason for name change" value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /><Button size="sm" disabled={disabled || !name.trim() || !reason.trim() || name.trim() === String(team.name ?? "")} onClick={() => void run("renameTeam", { team_id: team.id, name: name.trim(), reason: reason.trim() })}>Save team name</Button></div></details>}
    {["registration_open", "registration_closed", "ready"].includes(state) && <details><summary className="cursor-pointer text-xs">Remove team</summary><ImpactReview tournamentId={String(event.id)} revision={Number(event.revision)} kind="withdrawal" proposal={{ entry_id: team.id }} disabled={disabled} owner={owner} matchLabel={matchLabel} run={run} /></details>}
    {(state === "active" || (state === "completed" && owner)) && <details><summary className="cursor-pointer text-xs">Withdraw team</summary><TeamWithdrawal snapshot={snapshot} disabled={disabled} label={label} selectedTeamId={team.id} run={run} /></details>}
    <p className="text-xs text-gray-600">To replace a team member, open Edit player on their position.</p>
  </div></details>;
}
