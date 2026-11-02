"use client";

import { individualRoster, positionedMembers } from "@/lib/tournament-builder/individual-roster";
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
  const [target, setTarget] = useState<{ slot: number; position: number } | null>(null);
  const [search, setSearch] = useState("");
  const locked = !individualRoster(snapshot)?.editable;
  const slotsPerTeam = doubles ? 2 : 1;
  const player = snapshot.tournament_players.find(row => row.user_id === actorId && row.status === "approved");
  const active = snapshot.team_members.find(row => row.user_id === actorId && row.membership_status === "active");
  const activeTeam = snapshot.teams.find(row => row.id === active?.team_id);
  const activeSlot = Number(activeTeam?.registration_slot);
  const members = (team: StorageRow | undefined) => team ? snapshot.team_members.filter(row => row.team_id === team.id && row.membership_status === "active") : [];
  const registeredPlayers = snapshot.tournament_players.filter(row => row.status === "approved");

  async function choose(slotIndex: number, position: number) {
    if (!player) {
      if (accepted && window.confirm("Join this tournament in this position using your Picktennt account?")) await run("joinTournament", { definition_id: definitionId, consent: true, slot_index: slotIndex, position });
      return;
    }
    const moving = activeSlot > 0 && activeSlot !== slotIndex;
    if (moving && !window.confirm("This will be your new team position. You will be removed from your current position. Continue?")) return;
    await run("selectEntrySlot", { slot_index: slotIndex, position });
  }
  async function assign(slotIndex: number, position: number) {
    if (!adminPlayerId) return;
    if (!window.confirm("This registered player will be placed in this team position. Continue?")) return;
    await run("placeRegisteredPlayer", { user_id: adminPlayerId, slot_index: slotIndex, position });
  }

  async function remove(userId: string, releaseOnly: boolean) {
    if (!window.confirm(releaseOnly ? "Free this player's position? They will remain registered in the tournament." : "Remove this player from the tournament? Their teammate will remain registered.")) return;
    await run("removeRegisteredPlayer", { user_id: userId, release_only: releaseOnly });
  }

  return <div className="space-y-4">
    {!player ? <div className="rounded-xl bg-gray-50 p-4"><h3 className="font-semibold">Join tournament</h3><p className="mt-1 text-sm text-gray-600">Choose an open position to join. Your name is already known from your Picktennt account.</p><label className="mt-3 block text-sm"><input type="checkbox" className="mr-2" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I accept the published rules.</label><p className="mt-3 text-sm">Accept the rules, then choose an open position below.</p></div> : <div className="rounded-xl bg-gray-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Choose your team position</h3><p className="text-sm text-gray-600">{activeSlot > 0 ? `Your current position is Team ${activeSlot}. Choose another open position to move.` : "Choose an open position to join a team."}</p></div><Button variant="outline" disabled={disabled || locked} onClick={() => { if (window.confirm("Leave this tournament and free your position?")) void run("cancelRegistration", {}); }}>Leave tournament</Button></div></div>}
    {locked && <p role="status" className="text-sm">Positions are locked. Player changes are unavailable after fixtures are generated.</p>}
    {admin && <p className="text-sm">Place a registered player: choose an open position. Only players who have already joined this tournament are available.</p>}
    {admin && target && <section className="rounded-xl border p-3" aria-label="Place a registered player">
      <p className="font-medium">Team {target.slot}, position {target.position}</p>
      <label className="block text-sm">Search registered players<input autoFocus type="search" className="mt-1 block w-full rounded-lg border p-2" value={search} onChange={event => { setSearch(event.target.value); setAdminPlayerId(""); }} /></label>
      <label className="mt-2 block text-sm">Registered player<select aria-label="Registered player" className="mt-1 block w-full rounded-lg border p-2" value={adminPlayerId} onChange={event => setAdminPlayerId(event.target.value)} disabled={locked}><option value="">Choose a registered player</option>{registeredPlayers.filter(row => name(row).toLowerCase().includes(search.toLowerCase()) && !snapshot.team_members.some(member => member.user_id === row.user_id && member.membership_status === "active" && snapshot.teams.some(team => team.id === member.team_id && Number(team.registration_slot) === target.slot))).map(row => <option key={row.id} value={String(row.user_id)}>{name(row)}</option>)}</select></label>
      <p className="my-2 text-xs">Only players who have already joined this tournament are available.</p>
      <Button disabled={locked || !adminPlayerId} onClick={async () => { await assign(target.slot, target.position); setTarget(null); setAdminPlayerId(""); }}>Place selected player</Button>
      <Button variant="outline" onClick={() => { setTarget(null); setAdminPlayerId(""); }}>Cancel</Button>
    </section>}
    <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: maxEntries }, (_, index) => {
      const slotIndex = index + 1;
      const team = snapshot.teams.find(row => Number(row.registration_slot) === slotIndex);
      const roster = positionedMembers(members(team), slotsPerTeam);
      const own = roster.some(row => row?.user_id === actorId);
      return <section key={slotIndex} aria-label={doubles ? `Team ${slotIndex}` : `Entry ${slotIndex}`} className="rounded-xl border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">{doubles ? "Team" : "Entry"} {slotIndex}</h3>
        <div className="space-y-2">{roster.map((member, index) => <div key={index} className="rounded-lg border px-3 py-2 text-sm">
          <p>Position {index + 1}: {member ? `${name(member)}${member.user_id === actorId ? " · You" : ""}` : locked ? "Locked" : "Open position"}</p>
          {!member && !locked && <div className="mt-2 flex flex-wrap gap-2">
            {!own && <Button size="sm" disabled={!player && !accepted} aria-label={`${player ? "Choose" : "Join"} team ${slotIndex} position ${index + 1}`} onClick={() => void choose(slotIndex, index + 1)}>{player ? activeSlot > 0 ? "Move here" : "Choose this position" : "Join this position"}</Button>}
            {admin && <Button size="sm" variant="outline" onClick={() => { setTarget({ slot: slotIndex, position: index + 1 }); setSearch(""); setAdminPlayerId(""); }}>Place registered player</Button>}
          </div>}
          {member && admin && !locked && <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void remove(String(member.user_id), true)}>Free position</Button>
            <Button size="sm" variant="outline" onClick={() => void remove(String(member.user_id), false)}>Remove player</Button>
          </div>}
        </div>)}</div>
      </section>;
    })}</div>
  </div>;
}
