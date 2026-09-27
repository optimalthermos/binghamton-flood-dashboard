import test from "node:test";
import assert from "node:assert/strict";
import { crestStatement, officialFloodProducts } from "../shared/floodWatch";

test("a crest below action and a crest at or above minor use the published stages", () => {
  assert.equal(
    crestStatement({ id: "01503000", name: "Conklin", peak: { stage: 4.2 }, thresholds: { action: 10, minor: 12 } }),
    "Conklin: forecast crest 4.2 ft, below the 10 ft action stage",
  );
  assert.equal(
    crestStatement({ id: "01503500", name: "Binghamton", peak: { stage: 16 }, thresholds: { action: 12, minor: 14 } }),
    "Binghamton: forecast crest 16.0 ft, at or above the 14 ft minor flood stage",
  );
});

test("a stale or missing crest stays unpublished", () => {
  assert.equal(
    crestStatement({ id: "01513500", name: "Vestal", stale: true, peak: { stage: 20 }, thresholds: { action: 10, minor: 12 } }),
    "Vestal: forecast crest unpublished",
  );
  assert.equal(
    crestStatement({ id: "01512500", name: "Chenango Forks", peak: null, thresholds: { action: 8, minor: 11 } }),
    "Chenango Forks: forecast crest unpublished",
  );
});

test("only official flood watches and warnings are selected", () => {
  const products = officialFloodProducts([
    { event: "Wind Advisory", headline: "Wind" },
    { event: "Flood Watch", headline: "Flood Watch" },
    { event: "Flash Flood Warning", headline: "Flash Flood Warning" },
    { event: "Flood Advisory", headline: "Flood Advisory" },
  ]);
  assert.deepEqual(products.map(item => item.event), ["Flash Flood Warning", "Flood Watch"]);
});
