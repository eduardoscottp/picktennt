"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Search, CheckCircle2 } from "lucide-react";

interface Props {
  profileId: string;
  firstName: string | null;
  lastName: string | null;
}

interface DuprCandidate {
  id: number;
  duprId: string;
  fullName: string;
  shortAddress: string | null;
}

export function SetupDupr({ profileId, firstName, lastName }: Props) {
  const [searchQuery, setSearchQuery] = useState(
    [firstName, lastName].filter(Boolean).join(" ")
  );
  const [results, setResults] = useState<DuprCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function runSearch(q: string) {
    if (q.trim().length < 2) { setResults([]); return; }
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
      setResults(data.results ?? []);
      setSearched(true);
    } catch (err: any) {
      setSearchError(err.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function handleInput(q: string) {
    setSearchQuery(q);
    setSearched(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 400);
  }

  async function selectCandidate(duprId: string) {
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ dupr_id: duprId })
        .eq("id", profileId);
      if (error) throw error;
      setSaved(true);
      toast("DUPR ID saved!", "success");
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (err: any) {
      toast(err.message ?? "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    router.push("/dashboard");
  }

  if (saved) {
    return (
      <div className="text-center space-y-4 py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
        <h2 className="text-xl font-black text-gray-900">You&apos;re all set!</h2>
        <p className="text-sm text-gray-500">Redirecting to dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="flex justify-center">
          <Image src="/images/logo.png" alt="Picktennt" width={48} height={48} className="object-contain" />
        </div>
        <h1 className="text-2xl font-black text-gray-900">
          Welcome{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p className="text-sm text-gray-500">
          Connect your DUPR profile so your tournament results count toward your rating.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <label className="block text-xs font-semibold text-gray-700">
          Search for your DUPR profile
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Your name as it appears on DUPR…"
            className="w-full h-11 rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent focus:bg-white"
            autoFocus
          />
        </div>

        {searching && <p className="text-xs text-gray-400 text-center py-3">Searching DUPR…</p>}
        {searchError && <p className="text-xs text-red-600 text-center py-3">{searchError}</p>}

        {searched && !searching && results.length === 0 && (
          <div className="text-center py-4 space-y-1">
            <p className="text-sm text-gray-500">No results found</p>
            <p className="text-xs text-gray-400">Try a different spelling or your full name</p>
          </div>
        )}

        {results.length > 0 && (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {results.map((c) => (
              <li
                key={c.duprId}
                className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{c.fullName}</div>
                  {c.shortAddress && (
                    <div className="text-xs text-gray-500">{c.shortAddress}</div>
                  )}
                  <div className="text-[11px] text-gray-400 font-mono">DUPR ID: {c.duprId}</div>
                </div>
                <Button
                  size="sm"
                  loading={saving}
                  onClick={() => selectCandidate(c.duprId)}
                >
                  This is me
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={skip}
          className="w-full text-center text-sm font-medium text-gray-500 hover:text-gray-700 py-2.5 transition-colors"
        >
          Skip for now
        </button>
        <button
          onClick={skip}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-500 py-1.5 transition-colors"
        >
          I don&apos;t have a DUPR account
        </button>
      </div>
    </div>
  );
}
