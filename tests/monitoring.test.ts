import test from "node:test";
import assert from "node:assert/strict";
import { observationState, ageLabel, stageCategory, durationMs, precipitationTotal } from "../shared/monitoring";
import { officialImpacts, officialRecordCrest, officialThresholds, parseObservedProduct } from "../server/monitoring";

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
  assert.deepEqual(officialImpacts({ flood: { stageUnits: "ft", impacts: [
    { stage: 18, statement: "  Water reaches Front Street. " },
    { stage: -9999, statement: "ignore" },
    { stage: 14, statement: "Low spots flood." },
    { stage: 12, statement: "" },
  ] } }), [
    { stage: 14, statement: "Low spots flood." },
    { stage: 18, statement: "Water reaches Front Street." },
  ]);
  assert.deepEqual(officialImpacts({ flood: { stageUnits: "m", impacts: [{ stage: 14, statement: "no" }] } }), []);
  assert.deepEqual(officialRecordCrest({ flood: { stageUnits: "ft", crests: { historic: [
    { stage: 20, occurredTime: "2006-06-28T00:00:00Z" },
    { stage: 25.73, occurredTime: "2011-09-08T20:00:00Z" },
    { stage: -999, occurredTime: "1999-01-01T00:00:00Z" },
  ] } } }), { stage: 25.73, occurredTime: "2011-09-08T20:00:00Z" });
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

test("NOAA fallback preserves timestamps and converts kcfs, not stage units", () => {
  const series = parseObservedProduct({ primaryName: "Stage", primaryUnits: "ft", secondaryName: "Flow", secondaryUnits: "kcfs", data: [
    { validTime: "2026-09-22T03:45:00Z", primary: 3.4, secondary: 1.66 },
    { validTime: "2026-09-22T03:30:00Z", primary: -9999, secondary: -999 },
  ] }, now);
  assert.deepEqual(series.stageTS[1], { timestamp: "2026-09-22T03:45:00Z", value: 3.4 });
  assert.equal(series.flowTS[1].value, 1660);
  assert.equal(series.stageTS[0].value, null);
  assert.equal(series.flowTS[0].value, null);
});
