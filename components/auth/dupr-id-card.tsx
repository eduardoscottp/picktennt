"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CheckCircle2, AlertCircle, Trophy, Search, X } from "lucide-react";

interface Props {
  profileId: string;
  currentDuprId: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface DuprCandidate {
  id: number;
  duprId: string;
  fullName: string;
  shortAddress: string | null;
}

export function DuprIdCard({ profileId, currentDuprId, firstName, lastName }: Props) {
  const [value, setValue] = useState(currentDuprId ?? "");
  const [saving, setSaving] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DuprCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();
  const { toast } = useToast();

  async function save() {
    const trimmed = value.trim();
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ dupr_id: trimmed || null })
        .eq("id", profileId);
      if (error) throw error;
      toast(trimmed ? "DUPR ID saved" : "DUPR ID removed", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  function openSearch() {
    const name = [firstName, lastName].filter(Boolean).join(" ");
    setSearchQuery(name || "");
    setSearchResults([]);
    setSearchError(null);
    setSearchOpen(true);
    if (name) runSearch(name);
  }

  async function runSearch(q: string) {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/dupr/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSearchResults(data.results ?? []);
    } catch (err: any) {
      setSearchError(err.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function handleSearchInput(q: string) {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 400);
  }

  function selectCandidate(duprId: string) {
    setValue(duprId);
    setSearchOpen(false);
  }

  const dirty = (value.trim() || null) !== (currentDuprId || null);
  const hasId = !!currentDuprId && currentDuprId.trim() !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-brand-500" />
          DUPR Connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasId ? (
          <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 flex items-center gap-2 text-xs text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Connected · DUPR ID <span className="font-mono font-bold">{currentDuprId}</span></span>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>Add your DUPR ID so tournament results upload to your DUPR profile.</span>
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              label="DUPR ID"
              placeholder="e.g. 67R4ND"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <button
            onClick={openSearch}
            className="mt-6 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-white border border-brand-200 rounded-xl px-3 py-2 transition-colors flex-shrink-0 h-11"
          >
            <Search className="h-3.5 w-3.5" />
            Find
          </button>
        </div>

        <Button onClick={save} loading={saving} disabled={!dirty} className="w-full">
          {hasId ? "Update DUPR ID" : "Save DUPR ID"}
        </Button>
        <p className="text-[11px] text-gray-400">
          Find your DUPR ID in the DUPR app → Profile → next to your name (short code like 67R4ND), or use the Find button to search.
        </p>

        {/* Search panel */}
        {searchOpen && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Search DUPR</span>
              <button onClick={() => setSearchOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Search by name…"
                className="w-full h-10 rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {searching && <p className="text-xs text-gray-400 text-center py-2">Searching…</p>}

            {searchError && (
              <div className="text-xs text-red-600 text-center py-2">{searchError}</div>
            )}

            {!searching && !searchError && searchResults.length === 0 && searchQuery.length >= 2 && (
              <p className="text-xs text-gray-400 text-center py-2">No players found</p>
            )}

            {searchResults.length > 0 && (
              <ul className="space-y-1 max-h-60 overflow-y-auto">
                {searchResults.map((c) => (
                  <li
                    key={c.duprId}
                    className="flex items-center justify-between gap-2 rounded-xl bg-white border border-gray-100 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{c.fullName}</div>
                      {c.shortAddress && (
                        <div className="text-xs text-gray-500">{c.shortAddress}</div>
                      )}
                      <div className="text-[11px] text-gray-400 font-mono">ID: {c.duprId}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => selectCandidate(c.duprId)}>
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
