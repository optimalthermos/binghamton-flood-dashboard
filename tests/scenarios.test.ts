import test from "node:test";
import assert from "node:assert/strict";
import { buildFloodPathways, type PathwayInput } from "../shared/scenarios";

const quiet: PathwayInput = {
  conklinStage: 3.4,
  conklinAction: 10,
  binghamtonStage: 2.82,
  binghamtonAction: 12,
  loadingNames: [],
  confluence: "STABLE",
  qpf24: 0.05,
  qpf48: 0.1,
  soilPct: 40,
  gwDepth: 8.9,
  frost: "NONE",
  precipMentioned: false,
  reservoirs: [
    { name: "Whitney Point Lake", pool: 973.3, action: 1009, minor: 1010 },
    { name: "East Sidney Lake", pool: 1151, action: 1202, minor: 1203 },
  ],
};

test("a quiet basin does not mark a flood pathway active", () => {
  const states = Object.fromEntries(buildFloodPathways(quiet).map(p => [p.id, p.state]));
  assert.equal(states.mainstem, "quiet");
  assert.equal(states.confluence, "quiet");
  assert.equal(states["wet-ground"], "quiet");
  assert.equal(states["frozen-ground"], "quiet");
  assert.equal(states.tributary, "quiet");
  assert.equal(states.reservoirs, "quiet");
  assert.match(buildFloodPathways(quiet).find(p => p.id === "mainstem")!.now, /2\.82 ft/);
});

test("rising rivers, wet ground, and rain mark those pathways", () => {
  const states = Object.fromEntries(buildFloodPathways({
    ...quiet,
    loadingNames: ["Conklin", "Binghamton"],
    confluence: "BOTH_RISING",
    qpf24: 1.2,
    qpf48: 1.8,
    soilPct: 80,
    gwDepth: 4.2,
    precipMentioned: true,
  }).map(p => [p.id, p.state]));
  assert.equal(states.mainstem, "watch");
  assert.equal(states.confluence, "active");
  assert.equal(states["wet-ground"], "active");
  assert.equal(states.tributary, "active");
});

test("frozen ground with forecast precipitation is its own pathway", () => {
  const frozen = buildFloodPathways({ ...quiet, frost: "HYDROLOGIC", precipMentioned: true })
    .find(p => p.id === "frozen-ground");
  assert.equal(frozen?.state, "active");
  assert.match(frozen?.how || "", /Frozen ground/);
});

test("a rise within 2 ft of action is an active main-stem pathway", () => {
  const pathway = buildFloodPathways({ ...quiet, conklinStage: 9, loadingNames: ["Conklin"] })
    .find(p => p.id === "mainstem");
  assert.equal(pathway?.state, "active");
});

test("missing frost or reservoir observations stay unknown", () => {
  const states = Object.fromEntries(buildFloodPathways({
    ...quiet,
    frost: null,
    reservoirs: [{ name: "Whitney Point Lake", pool: null, action: 1009, minor: 1010 }],
  }).map(p => [p.id, p.state]));
  assert.equal(states["frozen-ground"], "unknown");
  assert.equal(states.reservoirs, "unknown");
});
