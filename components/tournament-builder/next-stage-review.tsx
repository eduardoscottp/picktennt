"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Fixture, FixtureSlot } from "@/lib/tournament-builder/types";
import { graphSourceLabel } from "./graph-review";

type GraphFixture = { id: string; stage_id: string; match_id?: string | null; kind: string; team_a_id: string | null; team_b_id: string | null; side_a_eligible?: boolean | null; side_b_eligible?: boolean | null; side_sources: unknown[]; sources: unknown[]; outcome_kind?: "walkover" | "no_contest" | null; winner_team_id?: string | null };
type ReviewedFixture = Fixture & { resolved_entry_a?: string | null; resolved_entry_b?: string | null; automatic_outcome?: "walkover" | "no_contest" | null; automatic_winner_entry_id?: string | null };
type Review = { state: "ready" | "blocked" | "existing" | "finished"; reason?: string; preview_hash?: string; compatibility_mode?: boolean; no_eligible_champion?: boolean; missing_matches: number; pending_results: number; fixtures: (ReviewedFixture | GraphFixture)[] };

export function NoEligibleChampionNotice({ visible }: { visible: boolean }) {
  return visible ? <p role="status" className="text-sm text-amber-800">No eligible champion will be determined. Final placements will remain blocked for review.</p> : null;
}

export function ReviewedV1Fixtures({ fixtures, label }: { fixtures: ReviewedFixture[]; label: (id: unknown) => string }) {
  const lastRound = Math.max(0, ...fixtures.filter(f => !f.bronze).map(f => f.round));
  function title(fixture: Fixture) {
    if (fixture.bronze) return "Third place";
    if (fixture.round === lastRound) return "Final";
    if (fixture.round === lastRound - 1) return `Semifinal ${fixtures.filter(f => !f.bronze && f.round === fixture.round).findIndex(f => f.id === fixture.id) + 1}`;
    return `Round ${fixture.round} match ${fixtures.filter(f => !f.bronze && f.round === fixture.round).findIndex(f => f.id === fixture.id) + 1}`;
  }
  function side(slot: FixtureSlot) {
    if (slot.kind === "entry") return label(slot.entryId);
    const feeder = fixtures.find(fixture => fixture.id === slot.fixtureId);
    if (feeder?.automatic_outcome) return slot.kind === "winner" && feeder.automatic_winner_entry_id ? label(feeder.automatic_winner_entry_id) : "Vacant";
    return `${slot.kind === "winner" ? "Winner" : "Loser"} of ${feeder ? title(feeder) : "previous match"}`;
  }
  function resolvedSide(entry: string | null | undefined, slot: FixtureSlot) {
    if (entry) return label(entry);
    return entry === null && slot.kind === "entry" ? "Vacant" : side(slot);
  }
  return <ul className="space-y-1 text-sm">{fixtures.map(fixture => <li key={fixture.id}><strong>{title(fixture)}:</strong> {fixture.automatic_outcome ? <>{fixture.resolved_entry_a ? label(fixture.resolved_entry_a) : "Vacant"} vs {fixture.resolved_entry_b ? label(fixture.resolved_entry_b) : "Vacant"} · {fixture.automatic_outcome === "walkover" ? `Walkover: ${label(fixture.automatic_winner_entry_id)} advances automatically` : "No contest: no entry advances"}</> : <>{resolvedSide(fixture.resolved_entry_a, fixture.a)} vs {resolvedSide(fixture.resolved_entry_b, fixture.b)}</>}</li>)}</ul>;
}

export function ReviewedGraphFixtures({ fixtures, label, definition }: { fixtures: GraphFixture[]; label: (id: unknown) => string; definition: Record<string, unknown> }) {
  function graphSide(id: string | null, source: unknown, eligible: boolean | null | undefined) {
    if (eligible === false) return "Vacant";
    if (id) return label(id);
    if (source && typeof source === "object" && "kind" in source && source.kind === "entry" && "entryId" in source) return label(source.entryId);
    if (source && typeof source === "object" && "kind" in source && "node_id" in source && (source.kind === "winner" || source.kind === "loser")) {
      const feeder = fixtures.find(fixture => fixture.stage_id === source.node_id && (fixture.outcome_kind === "walkover" || fixture.outcome_kind === "no_contest"));
      if (feeder) return source.kind === "winner" && feeder.winner_team_id ? label(feeder.winner_team_id) : "Vacant";
    }
    return graphSourceLabel(source, definition);
  }
  return <ul className="space-y-1 text-sm">{fixtures.map(fixture => <li key={fixture.id}><strong>{fixture.kind === "final" ? "Final" : fixture.kind === "bronze" ? "Third place" : fixture.stage_id}:</strong> {fixture.outcome_kind && !fixture.match_id ? <>{fixture.team_a_id && fixture.side_a_eligible !== false ? label(fixture.team_a_id) : "Vacant"} vs {fixture.team_b_id && fixture.side_b_eligible !== false ? label(fixture.team_b_id) : "Vacant"} · {fixture.outcome_kind === "walkover" ? `Walkover: ${label(fixture.winner_team_id)} advances automatically` : "No contest: no entry advances"}</> : fixture.side_sources.length === 2 ? <>{graphSide(fixture.team_a_id, fixture.side_sources[0], fixture.side_a_eligible)} vs {graphSide(fixture.team_b_id, fixture.side_sources[1], fixture.side_b_eligible)}</> : fixture.sources.map(source => graphSourceLabel(source, definition)).join(", ")}</li>)}</ul>;
}

export function NextStageReview({ tournamentId, disabled, label, generate, definition }: { tournamentId: string; disabled: boolean; label: (id: unknown) => string; generate: (previewHash: string) => void; definition: Record<string, unknown> }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setError(""); setReview(null);
    try {
      const response = await fetch(`/api/tournament-builder/${tournamentId}/preview?kind=next-stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "Could not review the next stage.");
      setReview(result as Review);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not review the next stage."); }
    finally { setLoading(false); }
  }
  const fixtures = (review?.fixtures ?? []).filter((fixture): fixture is ReviewedFixture => 'stageId' in fixture);
  const graphFixtures = (review?.fixtures ?? []).filter((fixture): fixture is GraphFixture => 'stage_id' in fixture);
  const graphMatches = graphFixtures.length > 0 && <ReviewedGraphFixtures fixtures={graphFixtures} label={label} definition={definition} />;
  return <div className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Next stage</h3>
    <Button variant="outline" disabled={disabled} loading={loading} onClick={() => void load()}>Review next stage</Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {review?.state === "blocked" && <p role="status" className="text-sm text-amber-800">{review.reason === "RESULTS_INCOMPLETE" ? `${review.missing_matches} missing matches · ${review.pending_results} results need validation. Complete and validate them before continuing.` : review.reason === "UNRESOLVED_TIE" ? "Resolve the qualifying tie before continuing." : review.reason === "SCHEDULE_INCONSISTENT" ? "The saved schedule is incomplete or inconsistent. Review it before continuing." : review.reason === "UNSUPPORTED_FORMAT" ? "This stage cannot yet be generated automatically for the configured format. No matches have been created." : "The configured stage cannot be generated yet. Review the tournament standings and eligibility."}</p>}
    {review?.state === "blocked" && graphMatches}
    {review?.state === "existing" && <div className="space-y-2"><p role="status" className="text-sm">The next stage has already been generated. View its matches on the Matches page.{review.compatibility_mode ? " This format currently creates future games with the original scheduling flow, before this review." : ""}</p>{graphMatches}</div>}
    {review?.state === "finished" && <p role="status" className="text-sm">There are no further rounds in this format.</p>}
    {review?.state === "ready" && <div className="space-y-2"><p className="text-sm text-gray-600">Review the configured matches before creating them.{fixtures.some(fixture => fixture.automatic_outcome) || graphFixtures.some(fixture => fixture.outcome_kind && !fixture.match_id) ? " The automatic outcomes shown below will be recorded when you confirm." : ""}</p><NoEligibleChampionNotice visible={review.no_eligible_champion === true} />{fixtures.length > 0 && <ReviewedV1Fixtures fixtures={fixtures} label={label} />}{graphMatches}<Button disabled={disabled || !review.preview_hash} onClick={() => { if (review.preview_hash) generate(review.preview_hash); }}>Generate these matches</Button></div>}
  </div>;
}
