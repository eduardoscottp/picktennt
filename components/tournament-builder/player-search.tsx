"use client";

import { useEffect, useState } from "react";

type Player = { id: string; display_name: string; username: string | null };

export function PlayerSearch({ tournamentId, onSelect, onQueryChange }: { tournamentId: string; onSelect: (player: Player) => void; onQueryChange?: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Player[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const value = query.trim();
    if (value.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tournament-builder/${tournamentId}/players/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: value }), signal: controller.signal });
        const body = await response.json() as { players?: Player[]; message?: string };
        if (!response.ok) throw new Error(body.message ?? "Player search is unavailable.");
        setResults(body.players ?? []);
        setMessage(body.players?.length ? `${body.players.length} results` : "No matching accounts.");
      } catch (error) {
        if (!controller.signal.aborted) { setResults([]); setMessage(error instanceof Error ? error.message : "Player search is unavailable."); }
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, tournamentId]);
  return <div className="space-y-2"><label className="block text-sm font-medium">Find a Picktennt player<input type="search" value={query} onChange={event => { setQuery(event.target.value); setResults([]); setMessage(""); onQueryChange?.(); }} placeholder="Name, username or DUPR ID" className="mt-1 w-full rounded-lg border border-gray-200 p-2" /></label><p className="text-xs text-gray-500">Enter at least three characters and select an account.</p><p aria-live="polite" className="text-xs text-gray-500">{message}</p>{results.length > 0 && <ul className="space-y-1 rounded-lg border border-gray-200 p-1">{results.map(player => <li key={player.id}><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" onClick={() => { onSelect(player); setQuery(""); setResults([]); setMessage(""); }}>{player.display_name}{player.username && <span className="ml-2 text-gray-500">@{player.username}</span>}</button></li>)}</ul>}</div>;
}
