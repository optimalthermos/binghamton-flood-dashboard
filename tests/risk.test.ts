import test from "node:test";
import assert from "node:assert/strict";
import { scoreBasin, type BasinRiskInput } from "../shared/risk";

function basin(overrides: Partial<BasinRiskInput> = {}): BasinRiskInput {
  return {
    stageScore: 15,
    stageDetail: "below action",
    basinScore: 10,
    basinDetail: "draining",
    qpf48Inches: 0.65,
    rain6hInches: 0.08,
    windMph: 12,
    snowInches: 0,
    rainSnowHours: null,
    soilPct: 40,
    soilDetail: "near normal",
    gwScore: 10,
    gwDetail: "deep",
    gwAvailable: true,
    confluenceScore: 10,
    confluenceDetail: "falling",
    confluenceAvailable: true,
    recessionScore: 10,
    recessionDetail: "baseflow",
    ...overrides,
  };
}

test("a 6-hour burst scores above the same rain spread over 48 hours", () => {
  const spread = scoreBasin(basin({ qpf48Inches: 1.2, rain6hInches: 0.1 }));
  const burst = scoreBasin(basin({ qpf48Inches: 1.2, rain6hInches: 1.2 }));
  assert.ok(burst.compositeScore > spread.compositeScore);
  const burstFactor = burst.factors.find(factor => factor.name === "Peak 6h rain");
  assert.equal(burstFactor?.detail, `Peak 1.20" in any 6 hours of the next 48h`);
});

test("wind alone cannot lift a dry, falling basin to HIGH", () => {
  const scored = scoreBasin(basin({
    stageScore: 8,
    basinScore: 5,
    qpf48Inches: 0,
    rain6hInches: 0,
    windMph: 60,
    snowInches: 0,
    soilPct: 15,
    gwScore: 10,
    confluenceScore: 10,
    recessionScore: 10,
  }));
  assert.notEqual(scored.riskLevel, "HIGH");
  assert.equal(scored.riskLevel, "LOW");
  const wind = scored.factors.find(factor => factor.name === "Forecast wind");
  assert.equal(wind?.detail, "Peak forecast wind 60 mph in the next 48h");
});

test("missing wind is left out and a known zero snow score stays zero", () => {
  const scored = scoreBasin(basin({ windMph: null, snowInches: 0, rainSnowHours: null }));
  const wind = scored.factors.find(factor => factor.name === "Forecast wind");
  const frozen = scored.factors.find(factor => factor.name === "Frozen precipitation");
  assert.equal(wind?.weight, 0);
  assert.equal(frozen?.score, 0);
  assert.ok((frozen?.weight ?? 0) > 0);
});
