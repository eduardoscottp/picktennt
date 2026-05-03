"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { MobileHeader } from "@/components/layout/navbar";
import { ChevronRight, ChevronLeft } from "lucide-react";
import type { TournamentType, SecondRoundFormat, FinalsFormat, FinalsTrigger } from "@/types/database";

const STEPS = ["Basic Info", "Format", "Rounds & Finals", "Rules"];

interface FormState {
  name: string;
  court_count: string;
  max_players: string;
  type: TournamentType | "";
  games_per_player: string;
  second_round_format: SecondRoundFormat | "";
  advancement_count: string;
  finals_format: FinalsFormat | "";
  finals_trigger: FinalsTrigger | "";
  rules_text: string;
  is_public: boolean;
}

const INITIAL: FormState = {
  name: "", court_count: "2", max_players: "8", type: "",
  games_per_player: "4", second_round_format: "none",
  advancement_count: "0", finals_format: "none",
  finals_trigger: "none", rules_text: "", is_public: true,
};

export default function CreateTournamentPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const router = useRouter();
  const { toast } = useToast();

  function set(key: keyof FormState, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validateStep() {
    const e: typeof errors = {};
    if (step === 0) {
      if (!form.name.trim()) e.name = "Tournament name is required";
      if (!form.court_count || +form.court_count < 1) e.court_count = "At least 1 court";
      if (!form.max_players || +form.max_players < 2) e.max_players = "At least 2 players";
    }
    if (step === 1) {
      if (!form.type) e.type = "Select a tournament type";
      if (form.type && (!form.games_per_player || +form.games_per_player < 1))
        e.games_per_player = "Must be at least 1";
    }
    if (step === 2) {
      const adv = +form.advancement_count;
      if (adv > 0 && adv > +form.max_players)
        e.advancement_count = `Cannot exceed max players (${form.max_players})`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() { if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1)); }
  function back() { setStep((s) => Math.max(s - 1, 0)); }

  async function submit() {
    if (!validateStep()) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.from("tournaments").insert({
        name: form.name.trim(),
        created_by: user.id,
        court_count: +form.court_count,
        max_players: +form.max_players,
        type: form.type as TournamentType,
        games_per_player: form.type ? +form.games_per_player : null,
        second_round_format: "none" as SecondRoundFormat,
        advancement_count: form.advancement_count && +form.advancement_count > 0 ? +form.advancement_count : null,
        finals_format: "none" as FinalsFormat,
        finals_trigger: "none" as FinalsTrigger,
        rules_text: form.rules_text.trim() || null,
        is_public: form.is_public,
        status: "registration",
      }).select().single();

      if (error) throw error;

      // Auto-join creator as an approved player
      await supabase.from("tournament_players").insert({
        tournament_id: data.id,
        user_id: user.id,
        status: "approved",
        joined_via: "invite",
      });

      // For singles/doubles: also create a team for the creator
      if (form.type !== "mixed") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("id", user.id)
          .single();
        const teamName = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
          : user.email ?? "Creator";
        const { data: team } = await supabase
          .from("teams")
          .insert({ tournament_id: data.id, name: teamName })
          .select()
          .single();
        if (team) {
          await supabase.from("team_members").insert({ team_id: team.id, user_id: user.id });
        }
      }

      toast("Tournament created!", "success");
      router.push(`/tournaments/${data.id}`);
    } catch (err: any) {
      if (err.code === "23505" || err.message?.includes("tournaments_name_key")) {
        setErrors({ name: "This tournament name is already taken. Please choose another." });
        setStep(0);
      } else {
        toast(err.message ?? "Failed to create tournament", "error");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <MobileHeader title="Create Tournament" back="/dashboard" />

      <div className="px-4 py-6 space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`flex-1 h-1.5 rounded-full transition-colors ${i <= step ? "bg-brand-500" : "bg-gray-200"}`} />
            </div>
          ))}
        </div>
        <div className="text-sm font-semibold text-brand-600">Step {step + 1} of {STEPS.length}: {STEPS[step]}</div>

        {/* Step 0: Basic Info */}
        {step === 0 && (
          <Card>
            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Tournament Name"
                placeholder="e.g. Summer Slam 2025"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                error={errors.name}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Number of Courts"
                  type="number" min={1} max={20}
                  value={form.court_count}
                  onChange={(e) => set("court_count", e.target.value)}
                  error={errors.court_count}
                />
                <Input
                  label="Max Players"
                  type="number" min={2} max={256}
                  value={form.max_players}
                  onChange={(e) => set("max_players", e.target.value)}
                  error={errors.max_players}
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="is_public" type="checkbox"
                  checked={form.is_public}
                  onChange={(e) => set("is_public", e.target.checked)}
                  className="h-4 w-4 rounded text-brand-500 accent-brand-500"
                />
                <label htmlFor="is_public" className="text-sm font-medium text-gray-700">
                  Show tournament name in public search
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 1: Format */}
        {step === 1 && (
          <Card>
            <CardHeader><CardTitle>Tournament Format</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Type</label>
                {errors.type && <p className="text-xs text-red-500">{errors.type}</p>}
                <div className="grid grid-cols-1 gap-2">
                  {([
                    { val: "singles", label: "Singles", desc: "1 vs 1 — each player is their own team" },
                    { val: "doubles", label: "Doubles", desc: "2 vs 2 — fixed partner teams" },
                    { val: "mixed",   label: "Mixed",   desc: "Rotating partners — individual standings" },
                  ] as const).map((t) => (
                    <button
                      key={t.val}
                      type="button"
                      onClick={() => {
                        set("type", t.val);
                        if (t.val !== "mixed") {
                          const defaultRounds = Math.max(1, +form.max_players - 1);
                          setForm((f) => ({ ...f, type: t.val, games_per_player: String(defaultRounds) }));
                        }
                      }}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                        form.type === t.val
                          ? "border-brand-500 bg-brand-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="font-semibold text-gray-900">{t.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {form.type && (
                <Input
                  label={form.type === "mixed" ? "Games Per Player" : "Rounds (games per team)"}
                  type="number" min={1} max={200}
                  value={form.games_per_player}
                  onChange={(e) => set("games_per_player", e.target.value)}
                  error={errors.games_per_player}
                  hint={
                    form.type === "mixed"
                      ? "How many games each player plays in the mixed round"
                      : `Default ${Math.max(1, +form.max_players - 1)} = full round robin (every team plays every other team)`
                  }
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Bracket */}
        {step === 2 && (
          <Card>
            <CardHeader><CardTitle>Knockout Bracket</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">
                After the round robin ends, the top teams enter a single-elimination bracket.
                Semifinal losers play for 3rd place.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {([
                  { val: "0",  label: "No bracket",          desc: "Round robin only — final standings decide winner" },
                  { val: "2",  label: "Final only",           desc: "Top 2 play the Gold match" },
                  { val: "4",  label: "Semifinals + Final",   desc: "Top 4 → SF → 3rd place + Final" },
                  { val: "8",  label: "Quarterfinals + SF + Final", desc: "Top 8 → QF → SF → 3rd place + Final" },
                  { val: "16", label: "Round of 16 + …",     desc: "Top 16 → R16 → QF → SF → 3rd place + Final" },
                ] as const).map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => set("advancement_count", opt.val)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                      form.advancement_count === opt.val
                        ? "border-brand-500 bg-brand-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="font-semibold text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
              {errors.advancement_count && (
                <p className="text-xs text-red-500">{errors.advancement_count}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Rules */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Tournament Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Rules (optional)</label>
                <textarea
                  value={form.rules_text}
                  onChange={(e) => set("rules_text", e.target.value)}
                  placeholder="Enter any rules, scoring conventions, or notes for players..."
                  rows={8}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                />
                <p className="text-xs text-gray-400">Players can view this anytime. Only admins can edit.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="secondary" onClick={back} className="flex-1">
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next} className="flex-1">
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} loading={loading} className="flex-1">
              Create Tournament
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
