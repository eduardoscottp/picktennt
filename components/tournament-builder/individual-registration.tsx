"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";

type Props = {
  snapshot: CommandSnapshot;
  actorId: string;
  definitionId: string;
  doubles: boolean;
  maxEntries: number;
  admin: boolean;
  disabled: boolean;
  run: (command: string, data: Record<string, unknown>) => Promise<void>;
};

const name = (row: StorageRow | undefined) => typeof row?.display_name === "string" ? row.display_name : "Open position";

export function IndividualRegistration({ snapshot, actorId, definitionId, doubles, maxEntries, admin, disabled, run }: Props) {
  const [accepted, setAccepted] = useState(false);
  const [adminPlayerId, setAdminPlayerId] = useState("");
  const slotsPerTeam = doubles ? 2 : 1;
  const player = snapshot.tournament_players.find(row => row.user_id === actorId && row.status === "approved");
  const active = snapshot.team_members.find(row => row.user_id === actorId && row.membership_status === "active");
  const activeTeam = snapshot.teams.find(row => row.id === active?.team_id);
  const activeSlot = Number(activeTeam?.registration_slot);
  const members = (team: StorageRow | undefined) => team ? snapshot.team_members.filter(row => row.team_id === team.id && row.membership_status === "active") : [];
  const registeredPlayers = snapshot.tournament_players.filter(row => row.status === "approved");

  async function choose(slotIndex: number) {
    if (!player) return;
    const moving = activeSlot > 0 && activeSlot !== slotIndex;
    if (moving && !window.confirm("This will be your new team position. You will be removed from your current position. Continue?")) return;
    await run("selectEntrySlot", { slot_index: slotIndex });
  }
  async function assign(slotIndex: number) {
    if (!adminPlayerId) return;
    if (!window.confirm("This registered player will be placed in this team position. Continue?")) return;
    await run("placeRegisteredPlayer", { user_id: adminPlayerId, slot_index: slotIndex });
  }

  return <div className="space-y-4">
    {!player ? <div className="rounded-xl bg-gray-50 p-4"><h3 className="font-semibold">Join this tournament</h3><p className="mt-1 text-sm text-gray-600">Join first, then choose an open team position. Your name is already known from your Picktennt account.</p><label className="mt-3 block text-sm"><input type="checkbox" className="mr-2" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I accept the published rules.</label><Button className="mt-3" disabled={disabled || !accepted} onClick={() => void run("joinTournament", { definition_id: definitionId, consent: true })}>Join tournament</Button></div> : <div className="rounded-xl bg-gray-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Choose your team position</h3><p className="text-sm text-gray-600">{activeSlot > 0 ? `Your current position is Team ${activeSlot}. Choose another open position to move.` : "Choose an open position to join a team."}</p></div><Button variant="outline" disabled={disabled} onClick={() => void run("cancelRegistration", {})}>Leave tournament</Button></div></div>}
    {admin && <label className="block text-sm font-medium">Place a registered player<select className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2" value={adminPlayerId} onChange={event => setAdminPlayerId(event.target.value)} disabled={disabled}><option value="">Choose a registered player</option>{registeredPlayers.map(row => <option key={row.id} value={String(row.user_id)}>{name(row)}</option>)}</select><span className="mt-1 block text-xs font-normal text-gray-500">Only players who have already joined this tournament are available.</span></label>}
    <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: maxEntries }, (_, index) => {
      const slotIndex = index + 1;
      const team = snapshot.teams.find(row => Number(row.registration_slot) === slotIndex);
      const roster = members(team);
      const hasSpace = roster.length < slotsPerTeam;
      const own = roster.some(row => row.user_id === actorId);
      return <div key={slotIndex} className="rounded-xl border border-gray-200 p-3"><div className="mb-2 flex items-center justify-between"><strong className="text-sm">Team {slotIndex}</strong><span className="text-xs text-gray-500">{roster.length}/{slotsPerTeam}</span></div><div className="space-y-2">{Array.from({ length: slotsPerTeam }, (_, position) => { const member = roster[position]; return <div key={position} className={`rounded-lg px-3 py-2 text-sm ${member ? "bg-gray-100" : "border border-dashed border-gray-300 text-gray-500"}`}>{member ? `${name(member)}${member.user_id === actorId ? " · You" : ""}` : "Open position"}</div>; })}</div>{hasSpace && <div className="mt-3 flex flex-wrap gap-2">{player && !own && <Button size="sm" disabled={disabled} onClick={() => void choose(slotIndex)}>{activeSlot > 0 ? "Move here" : "Choose this position"}</Button>}{admin && adminPlayerId && <Button size="sm" variant="outline" disabled={disabled} onClick={() => void assign(slotIndex)}>Place selected player</Button>}{!player && <span className="text-xs text-gray-500">Join tournament first to choose this position.</span>}</div>}</div>;
    })}</div>
  </div>;
}
