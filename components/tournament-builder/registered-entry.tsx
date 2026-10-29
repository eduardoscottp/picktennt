"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResolvedPlayer = { id: string; display_name: string };
export function registeredEntryData(definitionId: string, playerIds: string[], entryName: string) {
  if (!UUID.test(definitionId) || ![1, 2].includes(playerIds.length) || playerIds.some(id => !UUID.test(id)) || new Set(playerIds).size !== playerIds.length || !entryName.trim() || entryName.length > 120) return null;
  return { definition_id: definitionId, player_ids: playerIds, entry_name: entryName.trim(), reason: "Administrator enrolled existing Picktennt accounts." };
}
export function RegisteredEntryForm({ definitionId, doubles, capacityFull, disabled, enrolledPlayerIds, run }: {
  definitionId: string; doubles: boolean; capacityFull: boolean; disabled: boolean;
  enrolledPlayerIds: readonly string[];
  run: (command: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const id = useId();
  const [playerUsername, setPlayerUsername] = useState("");
  const [partnerUsername, setPartnerUsername] = useState("");
  const [entryName, setEntryName] = useState("");
  const [players, setPlayers] = useState<ResolvedPlayer[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const normalize = (value: string) => value.trim().replace(/^@/, "").toLowerCase();
  const usernames = (doubles ? [playerUsername, partnerUsername] : [playerUsername]).map(normalize);
  const unique = new Set(usernames).size === usernames.length;
  const canLookup = unique && usernames.every(value => /^[a-z0-9_]{3,32}$/.test(value));
  const alreadyEnrolled = players.some(player => enrolledPlayerIds.includes(player.id));
  const payload = !alreadyEnrolled && players.length === usernames.length ? registeredEntryData(definitionId, players.map(player => player.id), entryName) : null;
  function changed() { setPlayers([]); setMessage(""); }
  async function lookup() {
    if (!canLookup || disabled || capacityFull || busy) return;
    setBusy(true); setPlayers([]); setMessage("");
    try {
      const resolved = await Promise.all(usernames.map(async username => {
        const response = await fetch("/api/tournament-builder/players/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
        const body = await response.json();
        if (!response.ok || typeof body.id !== "string" || !UUID.test(body.id) || typeof body.display_name !== "string") throw new Error(body.message ?? "Could not find that registered player.");
        return { id: body.id, display_name: body.display_name };
      }));
      if (new Set(resolved.map(player => player.id)).size !== resolved.length) throw new Error("Choose a different registered account for each player.");
      setPlayers(resolved); setEntryName(value => value.trim() ? value : resolved.map(player => player.display_name).join(" & ").slice(0, 120));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Player lookup is unavailable."); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={disabled || capacityFull || busy} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 disabled:opacity-60"><legend className="px-1 text-sm font-semibold">Register existing Picktennt players</legend>
    <p className="text-sm text-gray-600">Each player must already have a Picktennt account and profile. Existing DUPR links are preserved; DUPR verification and submission have separate checks. This records administrator enrollment, not personal acceptance of the rules.</p>
    <Input id={`${id}-player`} label="Player’s Picktennt username" value={playerUsername} maxLength={33} onChange={event => { setPlayerUsername(event.target.value); changed(); }} />
    {doubles && <Input id={`${id}-partner`} label="Partner’s Picktennt username" value={partnerUsername} maxLength={33} onChange={event => { setPartnerUsername(event.target.value); changed(); }} />}
    {!unique && usernames.every(Boolean) && <p className="text-sm text-red-600">Choose a different registered account for each player.</p>}
    <Button variant="outline" disabled={!canLookup || disabled || capacityFull || busy} loading={busy} onClick={() => void lookup()}>Find registered players</Button>
    {players.length > 0 && <p className="text-sm text-brand-700">Accounts found: {players.map(player => player.display_name).join(" & ")}</p>}
    {alreadyEnrolled && <p className="text-sm text-amber-800">One of these accounts already has an entry in this tournament.</p>}
    <Input id={`${id}-name`} label="Entry name" value={entryName} maxLength={120} onChange={event => setEntryName(event.target.value)} />
    {capacityFull && <p className="text-sm text-amber-800">All available entries are filled.</p>}
    {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
    <Button disabled={!payload || disabled || capacityFull || busy} onClick={() => { if (payload) void run("addRegisteredEntry", payload); }}>Enroll registered entry</Button>
  </fieldset>;
}
