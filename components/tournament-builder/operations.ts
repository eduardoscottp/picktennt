export interface PendingOperation {
  url: string; command: string;
  envelope: { operation_id: string; expected_revision?: number; data: Record<string, unknown> };
}
export interface OperationReceipt { operation_id: string; tournament_id: string; revision: number; status: string; data: Record<string, unknown> }
export type OperationOutcome = { kind: "success"; receipt: OperationReceipt } | { kind: "rejected"; status: number; code?: string; message: string } | { kind: "uncertain"; message: string };
export function rejectionFeedback(outcome: Extract<OperationOutcome, { kind: "rejected" }>) {
  const advice: Record<string, string> = { 
    COURT_BUSY: "Finish the active match on this court, or move this match to a free court.", PLAYER_BUSY: "Finish the player's active match before starting another.",
    STALE_REVISION: "Current information is being reloaded. Review it before trying again.", STALE_PREVIEW: "Preview the impact again before committing this change." };
  return { message: `${outcome.message}${outcome.code && advice[outcome.code] ? ` ${advice[outcome.code]}` : ""}`, refresh: outcome.code === "STALE_REVISION" };
}

export async function submitPending(operation: PendingOperation, request: typeof fetch = fetch): Promise<OperationOutcome> {
  try {
    const response = await request(operation.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation.envelope) });
    if (response.status >= 500) return { kind: "uncertain", message: "The response was interrupted. Check this action before starting another." };
    const result = await response.json();
    if (!response.ok) return { kind: "rejected", status: response.status, ...(typeof result.code === "string" ? { code: result.code } : {}), message: typeof result.message === "string" ? result.message : "This action was not accepted." };
    if (result.operation_id !== operation.envelope.operation_id || typeof result.tournament_id !== "string" || typeof result.revision !== "number") {
      return { kind: "uncertain", message: "The result could not be verified. Check this action before continuing." };
    }
    return { kind: "success", receipt: result as OperationReceipt };
  } catch { return { kind: "uncertain", message: "Connection interrupted. Your action is saved for a safe retry." }; }
}

export async function recoverPending(operation: PendingOperation, request: typeof fetch = fetch): Promise<OperationOutcome> {
  if (operation.command === "createDraft") return submitPending(operation, request);
  try {
    const path = operation.url.split("?")[0];
    const response = await request(`${path}?operation_id=${encodeURIComponent(operation.envelope.operation_id)}`, { cache: "no-store" });
    if (response.status >= 500) return { kind: "uncertain", message: "The saved action could not be checked yet. Try again when the connection is available." };
    const result = await response.json();
    if (!response.ok) return { kind: "rejected", status: response.status, ...(typeof result.code === "string" ? { code: result.code } : {}), message: typeof result.message === "string" ? result.message : "This action could not be checked with your current access." };
    if (result === null) return submitPending(operation, request);
    if (result.operation_id !== operation.envelope.operation_id || typeof result.tournament_id !== "string" || typeof result.revision !== "number") return { kind: "uncertain", message: "The saved result could not be verified. Please try again." };
    return { kind: "success", receipt: result as OperationReceipt };
  } catch { return { kind: "uncertain", message: "The connection is still interrupted. Your original action is saved." }; }
}
