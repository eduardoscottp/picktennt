"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function needsImpactAcknowledgment(kind: "correction" | "withdrawal", review: Record<string, unknown>, resolution: "ordinary" | "void_and_replay") {
  if (kind === "withdrawal") return review.round_robin_results_excluded === true;
  const affected = Array.isArray(review.affected_match_ids) ? review.affected_match_ids : [];
  return affected.length > 0 && (resolution === "void_and_replay" || review.ordinary_archives_dependents === true);
}

export function ImpactReview({ tournamentId, revision, kind, proposal, disabled, owner, matchLabel, run }: {
  tournamentId: string; revision: number; kind: "correction" | "withdrawal";
  proposal: Record<string, unknown>; disabled: boolean; owner: boolean;
  matchLabel: (id: string) => string; run: (command: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ fingerprint: string; result: Record<string, unknown> } | null>(null);
  const [acceptReplay, setAcceptReplay] = useState(false);
  const [resolution, setResolution] = useState<"ordinary" | "void_and_replay">("ordinary");
  const data = { ...proposal, ...(kind === "withdrawal" ? { reason: reason.trim() } : {}) };
  const fingerprint = JSON.stringify({ revision, data });
  const current = review?.fingerprint === fingerprint ? review.result : null;
  const affected = current && Array.isArray(current.affected_match_ids) ? current.affected_match_ids as string[] : [];
  const started = current && Array.isArray(current.started_dependent_ids) ? current.started_dependent_ids as string[] : [];
  const requiresAcknowledgment = current ? needsImpactAcknowledgment(kind, current, resolution) : false;
  async function preview() {
    setBusy(true); setError(""); setAcceptReplay(false);
    try {
      const response = await fetch(`/api/tournament-builder/${tournamentId}/preview?kind=${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok || typeof result.preview_hash !== "string") throw new Error(result.message ?? "This change cannot be previewed.");
      setResolution(Array.isArray(result.started_dependent_ids) && result.started_dependent_ids.length > 0 ? "void_and_replay" : "ordinary");
      setReview({ fingerprint, result });
    } catch (caught) { setReview(null); setError(caught instanceof Error ? caught.message : "Could not review this change."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3"><Input id={reasonId} label={kind === "correction" ? "Reason for correcting this accepted result" : "Reason for withdrawing this entry"} value={reason} maxLength={1000} disabled={disabled || busy} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="outline" disabled={disabled || busy || !reason.trim()} loading={busy} onClick={() => void preview()}>Review {kind === "correction" ? "correction" : "withdrawal"} impact</Button>{error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    {current && <div className="space-y-3 text-sm"><p>{affected.length} {affected.length === 1 ? "match is" : "matches are"} affected by this change.</p>{affected.length > 0 && <ul className="list-disc space-y-1 pl-5">{affected.map((id) => <li key={id}>{matchLabel(id)}</li>)}</ul>}{typeof current.timing === "string" && <p>Withdrawal timing: {current.timing.replaceAll("_", " ")}.</p>}{current.empty_qualifier_slots === true && <p>One or more qualifying places will remain empty.</p>}{current.qualification_pending === true && <p>Qualifying positions must be resolved again after this change.</p>}{current.dupr_history_unknown === true && <p className="rounded-lg bg-amber-100 p-3">Previously played results may have been submitted to DUPR. Review them separately; this action does not update DUPR.</p>}{kind === "withdrawal" && current.round_robin_results_excluded === true && <p className="rounded-lg bg-amber-100 p-3">The results of this team in the round robin will no longer count in the standings. The played matches remain in the history.</p>}
      {current.requires_reopen === true ? <div className="space-y-2"><p>The owner must reopen the completed results for review before committing this change. Recheck the impact after reopening.</p>{owner && <Button size="sm" variant="outline" disabled={disabled || !reason.trim()} onClick={() => void run("reopenResults", { reason: reason.trim() })}>Reopen results for review</Button>}</div> : <>
        {kind === "correction" && affected.length > 0 && started.length === 0 && <label className="block">How should dependent matches be handled?<select aria-label="Correction resolution" className="mt-1 block w-full rounded-lg border bg-white p-2" value={resolution} onChange={event => { setResolution(event.target.value as "ordinary" | "void_and_replay"); setAcceptReplay(false); }}><option value="ordinary">Apply ordinary correction</option><option value="void_and_replay">Archive affected matches and regenerate</option></select></label>}
        {requiresAcknowledgment && <label className="block rounded-lg bg-amber-100 p-3"><input type="checkbox" className="mr-2" checked={acceptReplay} onChange={(e) => setAcceptReplay(e.target.checked)} disabled={disabled} />{kind === "withdrawal" ? "I understand these results will be excluded from the standings." : `I understand that ${affected.length} affected matches will be archived and regenerated: ${affected.map(matchLabel).join("; ")}.`}</label>}
        <Button size="sm" variant="danger" disabled={disabled || busy || !reason.trim() || (requiresAcknowledgment && !acceptReplay)} onClick={() => void run(kind === "correction" ? "commitCorrection" : "withdrawEntry", { ...data, reason: reason.trim(), preview_hash: current.preview_hash, ...(kind === "correction" ? { resolution } : {}) })}>{kind === "correction" ? resolution === "void_and_replay" ? "Commit correction and void for replay" : "Commit reviewed correction" : "Confirm reviewed withdrawal"}</Button>
      </>}
    </div>}
  </div>;
}
