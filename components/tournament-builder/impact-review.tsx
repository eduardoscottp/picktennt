"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const data = { ...proposal, ...(kind === "withdrawal" ? { reason: reason.trim() } : {}) };
  const fingerprint = JSON.stringify({ revision, data });
  const current = review?.fingerprint === fingerprint ? review.result : null;
  const affected = current && Array.isArray(current.affected_match_ids) ? current.affected_match_ids as string[] : [];
  const started = current && Array.isArray(current.started_dependent_ids) ? current.started_dependent_ids as string[] : [];
  async function preview() {
    setBusy(true); setError(""); setAcceptReplay(false);
    try {
      const response = await fetch(`/api/tournament-builder/${tournamentId}/preview?kind=${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok || typeof result.preview_hash !== "string") throw new Error(result.message ?? "This change cannot be previewed.");
      setReview({ fingerprint, result });
    } catch (caught) { setReview(null); setError(caught instanceof Error ? caught.message : "Could not review this change."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3"><Input id={reasonId} label={kind === "correction" ? "Reason for correcting this accepted result" : "Reason for withdrawing this entry"} value={reason} maxLength={1000} disabled={disabled || busy} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="outline" disabled={disabled || busy || !reason.trim()} loading={busy} onClick={() => void preview()}>Review {kind === "correction" ? "correction" : "withdrawal"} impact</Button>{error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    {current && <div className="space-y-3 text-sm"><p>{affected.length} {affected.length === 1 ? "match is" : "matches are"} affected by this change.</p>{affected.length > 0 && <ul className="list-disc space-y-1 pl-5">{affected.map((id) => <li key={id}>{matchLabel(id)}</li>)}</ul>}{typeof current.timing === "string" && <p>Withdrawal timing: {current.timing.replaceAll("_", " ")}.</p>}{Number(current.empty_qualifier_slots) > 0 && <p>{Number(current.empty_qualifier_slots)} qualifying places will remain empty.</p>}{current.qualification_pending === true && <p>Qualifying positions must be resolved again after this change.</p>}
      {current.requires_reopen === true ? <div className="space-y-2"><p>The owner must reopen the completed results for review before committing this change. Recheck the impact after reopening.</p>{owner && <Button size="sm" variant="outline" disabled={disabled || !reason.trim()} onClick={() => void run("reopenResults", { reason: reason.trim() })}>Reopen results for review</Button>}</div> : <>
        {started.length > 0 && <label className="block rounded-lg bg-amber-100 p-3"><input type="checkbox" className="mr-2" checked={acceptReplay} onChange={(e) => setAcceptReplay(e.target.checked)} disabled={disabled} />I understand that {started.length} started dependent matches will be voided and replayed: {started.map(matchLabel).join("; ")}.</label>}
        <Button size="sm" variant="danger" disabled={disabled || busy || !reason.trim() || (started.length > 0 && !acceptReplay)} onClick={() => void run(kind === "correction" ? "commitCorrection" : "withdrawEntry", { ...data, reason: reason.trim(), preview_hash: current.preview_hash, ...(kind === "correction" ? { resolution: started.length ? "void_and_replay" : "ordinary" } : {}) })}>{kind === "correction" ? started.length ? "Commit correction and void for replay" : "Commit reviewed correction" : "Confirm reviewed withdrawal"}</Button>
      </>}
    </div>}
  </div>;
}
