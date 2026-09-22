import test from "node:test";
import assert from "node:assert/strict";
import { observationState, ageLabel, stageCategory, durationMs, precipitationTotal } from "../shared/monitoring";
import { officialThresholds } from "../server/monitoring";

const now = Date.parse("2026-09-22T04:00:00Z");
test("missing, offline, stale and future observations cannot be current", () => {
  assert.equal(observationState(null, false, now), "unavailable");
  assert.equal(observationState("invalid", false, now), "unavailable");
  assert.equal(observationState("2026-09-22T03:00:00Z", true, now), "unavailable");
  assert.equal(observationState("2026-09-22T00:00:00Z", false, now), "stale");
  assert.equal(observationState("2026-09-22T05:00:00Z", false, now), "stale");
  assert.equal(observationState("2026-09-22T03:45:00Z", false, now), "current");
});
test("stage categories use exact source thresholds, including zero", () => {
  assert.equal(stageCategory(12, { minor: 12, action: 10 }), "Minor flood");
  assert.equal(stageCategory(20, { major: 20, minor: 12 }), "Major flood");
  assert.equal(stageCategory(20, { major: 20 }, false), "Unknown");
  assert.equal(stageCategory(null, { action: 10 }), "Unknown");
  assert.equal(stageCategory(0, { action: 0 }), "Action stage");
  assert.equal(stageCategory(2, {}), "No threshold");
});
test("official metadata rejects sentinel values and incorrect units", () => {
  assert.deepEqual(officialThresholds({ flood: { stageUnits: "ft", categories: { action: { stage: 10 }, minor: { stage: -9999 }, major: { stage: 20 } } } }), { action: 10, major: 20 });
  assert.deepEqual(officialThresholds({ flood: { stageUnits: "m", categories: { action: { stage: 10 } } } }), {});
  assert.deepEqual(officialThresholds(null), {});
});
test("rain windows exclude past rain and prorate crossing intervals", () => {
  const result = precipitationTotal([
    { validTime: "2026-09-21T00:00:00Z/PT24H", value: 254 },
    { validTime: "2026-09-22T01:00:00Z/PT6H", value: 25.4 },
    { validTime: "2026-09-22T07:00:00Z/PT24H", value: 25.4 },
  ], 24, now);
  assert.equal(result.inches, 1.38);
  assert.equal(result.coverageHours, 24);
});
test("missing rain is incomplete, not a verified zero", () => {
  assert.deepEqual(precipitationTotal([], 24, now), { inches: 0, coverageHours: 0 });
  assert.deepEqual(precipitationTotal([{ validTime: "2026-09-22T04:00:00Z/P1D", value: null }], 24, now), { inches: 0, coverageHours: 0 });
  assert.equal(durationMs("P1DT6H"), 30 * 3600_000);
  assert.equal(durationMs("bad"), 0);
});
test("timestamp labels do not claim invalid data is fresh", () => {
  assert.equal(ageLabel("bad", now), "Not reported");
  assert.equal(ageLabel("2026-09-22T03:45:00Z", now), "15m ago");
  assert.equal(ageLabel("2026-09-22T05:00:00Z", now), "Check source time");
});
