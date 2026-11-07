import assert from "node:assert/strict";
import test from "node:test";
import { needsImpactAcknowledgment } from "../../components/tournament-builder/impact-review";

test("review requires acknowledgment when standings results are excluded or matches are archived", () => {
  assert.equal(needsImpactAcknowledgment("withdrawal", { round_robin_results_excluded: true }, "ordinary"), true);
  assert.equal(needsImpactAcknowledgment("withdrawal", { round_robin_results_excluded: false }, "ordinary"), false);
  assert.equal(needsImpactAcknowledgment("correction", { affected_match_ids: ["final"] }, "ordinary"), false);
  assert.equal(needsImpactAcknowledgment("correction", { affected_match_ids: ["final"] }, "void_and_replay"), true);
  assert.equal(needsImpactAcknowledgment("correction", { affected_match_ids: ["final"], ordinary_archives_dependents: true }, "ordinary"), true);
  assert.equal(needsImpactAcknowledgment("correction", { affected_match_ids: [], ordinary_archives_dependents: true }, "ordinary"), false);
});
