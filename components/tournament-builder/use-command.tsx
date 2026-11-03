"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { submitPending, recoverPending, rejectionFeedback, type PendingOperation, type OperationReceipt } from "./operations";

function subscribe(listener: () => void) {
  window.addEventListener("picktennt:operation", listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener("picktennt:operation", listener); window.removeEventListener("storage", listener); };
}
function changed() { window.dispatchEvent(new Event("picktennt:operation")); }

export function useTournamentCommand(actorId: string, eventId: string | undefined, revision: number, onSuccess: (receipt: OperationReceipt) => Promise<void>) {
  const key = `picktennt:builder:${actorId}:${eventId ?? "new"}`;
  const saved = useSyncExternalStore(subscribe, () => { try { return sessionStorage.getItem(key) ?? ""; } catch { return "unavailable"; } }, () => null);
  let pending: PendingOperation | null = null;
  let ready = saved !== null;
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as PendingOperation;
      const base = eventId ? `/api/tournament-builder/${eventId}/commands?command=` : "/api/tournament-builder/drafts";
      if (typeof parsed.url !== "string" || !(eventId ? parsed.url.startsWith(base) : parsed.url === base) || !parsed.envelope?.operation_id) throw new Error("Invalid saved operation.");
      pending = parsed;
    } catch { ready = false; }
  }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<{ matchId?: string; message: string } | null>(null);
  const locked = useRef(false);
  function clear() { sessionStorage.removeItem(key); changed(); }
  async function send(operation: PendingOperation, recovering = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(""); setFeedback(null);
    const matchId = typeof operation.envelope.data.match_id === "string" ? operation.envelope.data.match_id : undefined;
    try {
      const outcome = await (recovering ? recoverPending(operation) : submitPending(operation));
      if (outcome.kind === "uncertain") { setMessage(outcome.message); setFeedback({ matchId, message: outcome.message }); }
      else if (outcome.kind === "rejected") {
        const rejected = rejectionFeedback(outcome);
        clear(); setMessage(rejected.message); setFeedback({ matchId, message: rejected.message });
        if (rejected.refresh && eventId) await onSuccess({ operation_id: operation.envelope.operation_id, tournament_id: eventId, revision, status: "stale", data: {} });
      } else { clear(); await onSuccess(outcome.receipt); }
    } catch { const message = "Your action may have completed. Reload to review the current tournament."; setMessage(message); setFeedback({ matchId, message }); }
    finally { locked.current = false; setBusy(false); }
  }
  async function run(command: string, data: Record<string, unknown>) {
    if (!ready || pending || locked.current) return;
    const operation: PendingOperation = {
      command, url: eventId ? `/api/tournament-builder/${eventId}/commands?command=${encodeURIComponent(command)}` : "/api/tournament-builder/drafts",
      envelope: { operation_id: crypto.randomUUID(), ...(eventId ? { expected_revision: revision } : {}), data },
    };
    try { sessionStorage.setItem(key, JSON.stringify(operation)); changed(); }
    catch { setMessage("Your browser could not save this action for recovery. No change was sent."); return; }
    await send(operation);
  }
  async function recover() {
    if (!pending || locked.current) return;
    await send(pending, true);
  }
  const notice = message || (pending ? "A previous action needs to be checked before continuing." : saved !== null && !ready ? "Saved actions could not be read. Enable browser session storage and reload before making changes." : "");
  return { run, feedback, disabled: !ready || busy || pending !== null,
    notice: <div aria-live="polite" className="space-y-2">{notice && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}{pending && <Button type="button" variant="outline" loading={busy} onClick={() => void recover()}>Check saved action</Button>}</div> };
}
