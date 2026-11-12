"use client";

import { adminPlacement, displayRosterTeams, individualRoster, positionedMembers, unassignedRegisteredPlayers } from "@/lib/tournament-builder/individual-roster";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Users } from "lucide-react";
import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import { PlayerSearch } from "./player-search";
import { PlayerActions } from "./player-actions";
import { tournamentTeamLabel } from "@/lib/tournament-builder/team-label";
import { TeamActions } from "./team-actions";

type Props = {
  snapshot: CommandSnapshot;
  actorId: string;
  definitionId: string;
  doubles: boolean;
  maxEntries: number;
  admin: boolean;
  owner: boolean;
  matchLabel: (id: string) => string;
  disabled: boolean;
  feedback?: string;
  run: (command: string, data: Record<string, unknown>) => Promise<void>;
};

const name = (row: StorageRow | undefined) => typeof row?.display_name === "string" ? row.display_name : "Open position";

export function IndividualRegistration({ snapshot, actorId, definitionId, doubles, maxEntries, admin, owner, matchLabel, disabled, feedback, run }: Props) {
  const [accepted, setAccepted] = useState(false);
  const [joinTarget, setJoinTarget] = useState<{ slot: number; position: number } | null>(null);
  const [target, setTarget] = useState<{ slot: number; position: number } | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const locked = !individualRoster(snapshot)?.editable;
  const slotsPerTeam = doubles ? 2 : 1;
  const unassigned = admin ? unassignedRegisteredPlayers(snapshot) : [];
  const player = snapshot.tournament_players.find(row => row.user_id === actorId && row.status === "approved");
  const pendingPlayer = snapshot.tournament_players.find(row => row.user_id === actorId && row.status === "pending");
  const active = snapshot.team_members.find(row => row.user_id === actorId && row.membership_status === "active");
  const activeTeam = snapshot.teams.find(row => row.id === active?.team_id);
  const activeSlot = Number(activeTeam?.registration_slot);
  const members = (team: StorageRow | undefined) => team ? snapshot.team_members.filter(row => row.team_id === team.id && ["active", "pending"].includes(String(row.membership_status))) : [];
  const adminCanAssign = admin && ["registration_open", "registration_closed", "ready", "active"].includes(String(snapshot.event?.modular_state));
  const availablePositions = displayRosterTeams(snapshot.teams, maxEntries, false).flatMap((team, index) => {
    if (!adminCanAssign || (!team && snapshot.matches.length) || (team && team.entry_state !== "approved")) return [];
    return positionedMembers(members(team), slotsPerTeam).flatMap((member, position) => member ? [] : [{ slot: index + 1, position: position + 1 }]);
  });
  const joinTeam = joinTarget && snapshot.teams.find(row => Number(row.registration_slot) === joinTarget.slot);
  const joinPositionOpen = joinTarget && !positionedMembers(members(joinTeam || undefined), slotsPerTeam)[joinTarget.position - 1];

  async function choose(slotIndex: number, position: number) {
    if (!player) {
      setAccepted(false);
      setJoinTarget({ slot: slotIndex, position });
      return;
    }
    const moving = activeSlot > 0;
    if (moving && !window.confirm("This will be your new team position. You will be removed from your current position. Continue?")) return;
    await run("selectEntrySlot", { slot_index: slotIndex, position });
  }
  async function assign(selected: { id: string; display_name: string }, slotIndex: number, position: number) {
    const placement = adminPlacement(snapshot.team_members, selected.id, locked);
    if (placement !== "add") {
      if (placement === "blocked") {
        setSelectionError("This player already has a position or pending request. Positions cannot be moved at this stage; review the roster.");
        return;
      }
      if (!window.confirm(`${selected.display_name} already has a position and will be moved to team ${slotIndex}, position ${position}. Continue?`)) return;
      await run("placeRegisteredPlayer", { user_id: selected.id, slot_index: slotIndex, position });
    } else {
      await run("adminFillPosition", { user_id: selected.id, slot_index: slotIndex, position, reason: "Placed by tournament administrator" });
    }
  }

  return <div className="space-y-4">
    {!admin && pendingPlayer && <div className="rounded-xl bg-amber-50 p-4 text-sm"><p>Your request is pending organizer approval. Your selected position is held.</p>{!locked && <Button variant="outline" disabled={disabled} onClick={() => { if (window.confirm("Cancel your pending request and release your position?")) void run("cancelRegistration", {}); }}>Cancel request</Button>}</div>}
    {!admin && !pendingPlayer && !locked && (!player ? <div className="rounded-xl bg-gray-50 p-4"><h3 className="font-semibold">Join tournament</h3><p className="mt-1 text-sm text-gray-600">Choose an open position to join. Your name is already known from your Picktennt account.</p></div> : <div className="rounded-xl bg-gray-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Choose your {doubles ? "team" : "entry"} position</h3><p className="text-sm text-gray-600">{activeSlot > 0 ? `Your current position is ${doubles ? "Team" : "Entry"} ${activeSlot}. Choose another open position to move.` : "Choose an open position."}</p></div><Button variant="outline" disabled={disabled} onClick={() => { if (window.confirm("Leave this tournament and free your position?")) void run("cancelRegistration", {}); }}>Leave tournament</Button></div></div>)}
    <Dialog open={!!joinTarget} onOpenChange={open => { if (!open) { setJoinTarget(null); setAccepted(false); } }}>
      <DialogContent className="mx-0 w-[calc(100%-2rem)]">
        <DialogHeader><DialogTitle>Join tournament</DialogTitle><DialogDescription>Do you want to join {doubles ? "Team" : "Entry"} {joinTarget?.slot}, position {joinTarget?.position}?</DialogDescription></DialogHeader>
        <label className="block text-sm"><input type="checkbox" className="mr-2" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I accept the published rules.</label>
        {!joinPositionOpen && <p role="status" className="mt-3 text-sm text-amber-800">This position is no longer available. Please choose another.</p>}
        <div className="mt-5 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => { setJoinTarget(null); setAccepted(false); }}>No</Button><Button type="button" disabled={disabled || locked || !!player || !!pendingPlayer || !accepted || !joinPositionOpen} onClick={() => { if (!joinTarget || !accepted || !joinPositionOpen || disabled || locked || player || pendingPlayer) return; const selected = joinTarget; setJoinTarget(null); setAccepted(false); void run("joinTournament", { definition_id: definitionId, consent: true, slot_index: selected.slot, position: selected.position }); }}>Yes, join</Button></div>
      </DialogContent>
    </Dialog>
    {!admin && locked && <p role="status" className="text-sm text-gray-600">Player self-service positions are locked.{player && " To leave the tournament, contact the administrator."}</p>}
    {adminCanAssign && <p className="text-sm">Choose an open position and find an existing Picktennt account. An administrator can enroll the player directly.</p>}
    {unassigned.length > 0 && <section className="rounded-xl bg-amber-50 p-4 text-sm" aria-label="Registered players without a position">
      <h4 className="font-semibold">Registered players without a position</h4>
      <p>These players count toward tournament capacity. Assign a position or remove their registration to free capacity.</p>
      <ul className="mt-2 space-y-3">{unassigned.map(player => {
        const userId = String(player.user_id);
        const selected = assignment[userId] ?? "";
        return <li key={userId} className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name(player)}</span>
          {adminCanAssign && <><select aria-label={`Position for ${name(player)}`} className="rounded-md border border-gray-300 bg-white p-2" value={selected} disabled={disabled || availablePositions.length === 0} onChange={event => setAssignment(current => ({ ...current, [userId]: event.target.value }))}><option value="">Choose a position</option>{availablePositions.map(choice => <option key={`${choice.slot}:${choice.position}`} value={`${choice.slot}:${choice.position}`}>{doubles ? "Team" : "Entry"} {choice.slot} · Position {choice.position}</option>)}</select><Button size="sm" variant="outline" disabled={disabled || !selected} onClick={() => { const [slot, position] = selected.split(":").map(Number); void run("adminFillPosition", { user_id: userId, slot_index: slot, position, reason: "Placed by tournament administrator" }); }}>Assign position</Button></>}
          {!locked && <Button size="sm" variant="outline" disabled={disabled} onClick={() => { if (window.confirm(`Remove ${name(player)} from the tournament? This frees their registration capacity.`)) void run("removeRegisteredPlayer", { user_id: userId, release_only: false }); }}>Remove from tournament</Button>}
        </li>;
      })}</ul>
      {feedback && <p role="alert" className="mt-2 text-amber-800">{feedback}</p>}
      {locked && <p className="mt-2">Removing an unassigned registration is only available while registration is open and positions are editable.</p>}
    </section>}
    <div className="grid grid-cols-2 gap-3">{displayRosterTeams(snapshot.teams, maxEntries, !admin && locked).map((team, index) => {
      const slotIndex = index + 1;
      const roster = positionedMembers(members(team), slotsPerTeam);
      const full = roster.every(Boolean);
      return <Card key={slotIndex} aria-label={doubles ? `Team ${slotIndex}` : `Entry ${slotIndex}`} className={`overflow-hidden ${full ? "border-green-200" : ""}`}>
        <CardHeader className={`h-12 justify-center border-b px-3 py-2 ${full ? "bg-green-50" : "bg-brand-50"}`}><CardTitle className={`flex min-w-0 items-center gap-1.5 text-xs font-bold ${full ? "text-green-700" : "text-brand-700"}`}><Users className="h-3 w-3 shrink-0" /><span className="min-w-0 flex-1 line-clamp-2 break-all" title={tournamentTeamLabel(snapshot, team, doubles, slotIndex)}>{tournamentTeamLabel(snapshot, team, doubles, slotIndex)}</span>{full && <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Ready</span>}</CardTitle></CardHeader>
        <CardContent className="p-2.5 space-y-1.5">{roster.map((member, index) => {
          const parts = member ? name(member).trim().split(/\s+/) : [];
          return <div key={index}>
            {member ? <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5"><Avatar className="h-6 w-6 flex-shrink-0"><AvatarImage src={typeof member.avatar_url === "string" ? member.avatar_url : ""} /><AvatarFallback className="text-[9px]">{parts.map(part => part[0]).slice(0, 2).join("").toUpperCase()}</AvatarFallback></Avatar><span className="text-xs font-medium text-gray-900 flex-1 truncate">{name(member)}{member.membership_status === "pending" && member.display_name !== "Pending approval" && <span className="ml-1 text-amber-700">· Pending approval</span>}{member.user_id === actorId && <span className="ml-1 text-brand-500">(you)</span>}</span></div> : <>
              {adminCanAssign && (team || !snapshot.matches.length) ? target?.slot === slotIndex && target.position === index + 1 ? <fieldset disabled={disabled} className="space-y-2 rounded-lg border border-gray-200 p-2 disabled:opacity-50"><p className="text-xs text-gray-500">Position {index + 1} · Open</p>{typeof snapshot.event?.id === "string" && <PlayerSearch tournamentId={snapshot.event.id} onQueryChange={() => setSelectionError("")} onSelect={selected => void assign(selected, slotIndex, index + 1)} />}{(selectionError || feedback) && <p role="alert" className="text-sm text-amber-800">{selectionError || feedback}</p>}<Button size="sm" variant="outline" onClick={() => { setTarget(null); setSelectionError(""); }}>Cancel</Button></fieldset> : <button type="button" disabled={disabled} aria-label={`Place registered player in team ${slotIndex} position ${index + 1}`} className="w-full flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-2 py-1.5 text-left text-xs text-gray-400 hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50" onClick={() => { setTarget({ slot: slotIndex, position: index + 1 }); setSelectionError(""); }}>Position {index + 1} · Open</button> : locked || admin || pendingPlayer ? <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-2 py-1.5 text-xs text-gray-400">Position {index + 1} · {admin || pendingPlayer ? "Open" : "Locked for players"}</div> : <button type="button" disabled={disabled || !!pendingPlayer} aria-label={`${player ? "Choose" : "Join"} team ${slotIndex} position ${index + 1}`} onClick={() => void choose(slotIndex, index + 1)} className="w-full flex items-center gap-2 rounded-lg border-2 border-dashed border-brand-300 px-2 py-1.5 hover:border-brand-500 hover:bg-brand-50 transition-colors group disabled:opacity-50"><div className="h-6 w-6 rounded-full border-2 border-brand-300 flex items-center justify-center flex-shrink-0"><Plus className="h-3 w-3 text-brand-400" /></div><span className="text-xs text-brand-500 font-medium">{player ? activeSlot > 0 ? "Move here" : "Choose this spot" : "Join this spot"}</span></button>}
            </>}
            {member && member.membership_status === "active" && admin && team && <PlayerActions snapshot={snapshot} team={team} member={member} disabled={disabled} run={run} />}
          </div>;
        })}{admin && team?.entry_state === "approved" && <TeamActions snapshot={snapshot} team={team} label={id => { const index = snapshot.teams.findIndex(row => row.id === id); return tournamentTeamLabel(snapshot, snapshot.teams[index], doubles, index + 1); }} disabled={disabled} owner={owner} matchLabel={matchLabel} run={run} />}</CardContent>
      </Card>;
    })}</div>
  </div>;
}
