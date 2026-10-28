import assert from "node:assert/strict";
import test from "node:test";
import { submitPending, recoverPending, rejectionFeedback, type PendingOperation } from "../../components/tournament-builder/operations";
const operation: PendingOperation = { url: "/api/tournament-builder/event/commands?command=startTournament", command: "startTournament", envelope: { operation_id: "same-operation", expected_revision: 4, data: {} } };
test("an interrupted operation retries the identical identity and revision", async () => {
  const bodies: string[] = [];
  const failed: typeof fetch = async (_url, options) => { bodies.push(String(options?.body)); throw new Error("network"); };
  assert.equal((await submitPending(operation, failed)).kind, "uncertain");
  const retried: typeof fetch = async (_url, options) => { bodies.push(String(options?.body)); return Response.json({ operation_id: "same-operation", tournament_id: "event", revision: 5 }); };
  assert.equal((await submitPending(operation, retried)).kind, "success");
  assert.equal(bodies[0], bodies[1]);
});
test("match failures retain their server code and actionable message; only stale revisions refresh", async () => {
  for (const [code, status, message, hint] of [
    ["COURT_BUSY", 400, "The assigned court is occupied.", "free court"], ["PLAYER_BUSY", 400, "A player is already playing.", "active match"],
    ["STALE_PREVIEW", 409, "Recompute correction impact.", "Preview the impact again"], ["IDEMPOTENCY_CONFLICT", 409, "The operation identity was already used.", "identity"]] as const) {
    const result = await submitPending(operation, async () => Response.json({ code, message }, { status }));
    assert.equal(result.kind, "rejected");
    if (result.kind !== "rejected") throw new Error("Expected rejection.");
    assert.equal(result.code, code);
    const feedback = rejectionFeedback(result);
    assert.equal(feedback.refresh, false);
    assert.ok(feedback.message.includes(message));
    assert.ok(feedback.message.includes(hint));
  }
  assert.equal(rejectionFeedback({ kind: "rejected", status: 409, code: "STALE_REVISION", message: "Refresh." }).refresh, true);
});
test("receipt recovery does not resend an already completed command", async () => {
  const methods: string[] = [];
  const outcome = await recoverPending(operation, async (_url, options) => { methods.push(options?.method ?? "GET"); return Response.json({ operation_id: "same-operation", tournament_id: "event", revision: 5 }); });
  assert.equal(outcome.kind, "success"); assert.deepEqual(methods, ["GET"]);
});
test("a missing receipt retries exactly the saved command without a new operation", async () => {
  const methods: string[] = [];
  const outcome = await recoverPending(operation, async (_url, options) => {
    methods.push(options?.method ?? "GET");
    if (!options?.method) return Response.json(null);
    assert.equal(JSON.parse(String(options.body)).operation_id, "same-operation");
    return Response.json({ operation_id: "same-operation", tournament_id: "event", revision: 5 });
  });
  assert.equal(outcome.kind, "success"); assert.deepEqual(methods, ["GET", "POST"]);
});
test("server errors remain uncertain while stale revisions permit a fresh review", async () => {
  assert.equal((await submitPending(operation, async () => new Response("failed", { status: 500 }))).kind, "uncertain");
  const stale = await submitPending(operation, async () => Response.json({ message: "Refresh current rules." }, { status: 409 }));
  assert.deepEqual(stale, { kind: "rejected", status: 409, message: "Refresh current rules." });
  assert.equal((await submitPending(operation, async () => Response.json({ operation_id: "other", tournament_id: "event", revision: 5 }))).kind, "uncertain");
});
