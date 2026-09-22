import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { registerRoutes } from "../server/routes";

const observedAt = "2026-09-22T03:45:00.000-04:00";

const officialFlood: Record<string, Record<string, number>> = {
  "01503500": { action: 12, minor: 14, moderate: 15, major: 18 },
  "01502731": { action: 13, minor: 17, moderate: 19, major: 20.5 },
  "01502632": { action: 11, minor: 15, moderate: 20, major: 22 },
  "01511000": { action: 1009, minor: 1010, moderate: -9999, major: -9999 },
};

function usgsSeries(site: string, parameter: string, value: string) {
  return {
    sourceInfo: { siteCode: [{ value: site }] },
    variable: { variableCode: [{ value: parameter }] },
    values: [{ value: [{ dateTime: observedAt, value }] }],
  };
}

test("Binghamton and Windsor use the real Susquehanna gauges and official stages", async () => {
  const originalFetch = globalThis.fetch;
  const requested = new Set<string>();
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    requested.add(url);
    if (url.includes("waterservices.usgs.gov")) {
      const sites = new URL(url).searchParams.get("sites")?.split(",") || [];
      const timeSeries = [];
      for (const site of sites) {
        if (site === "01503500") timeSeries.push(usgsSeries(site, "00065", "2.82"));
        else if (site === "01511000") timeSeries.push(usgsSeries(site, "62614", "973.27"));
        else timeSeries.push(usgsSeries(site, "00065", "3.00"), usgsSeries(site, "00060", "1000"));
      }
      return Response.json({ value: { timeSeries } });
    }
    const meta = url.match(/nwps\/v1\/gauges\/(\d+)$/);
    if (meta) {
      const categories = Object.fromEntries(
        Object.entries(officialFlood[meta[1]] || { action: 9, minor: 10 }).map(([key, stage]) => [key, { stage }]),
      );
      return Response.json({ flood: { stageUnits: "ft", categories }, name: meta[1], lid: "TEST" });
    }
    if (url.includes("/stageflow")) return Response.json({ observed: { data: [] } });
    throw new Error(`Unexpected test URL: ${url}`);
  }) as typeof fetch;

  const app = express();
  const server = createServer(app);
  try {
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const response = await originalFetch(`http://127.0.0.1:${address.port}/api/gauges`);
    assert.equal(response.status, 200);
    const data = await response.json();
    const ids = data.gauges.map((g: any) => g.id);
    assert.equal(ids.includes("01512780"), false);
    const binghamton = data.gauges.find((g: any) => g.id === "01503500");
    const windsor = data.gauges.find((g: any) => g.id === "01502731");
    const bainbridge = data.gauges.find((g: any) => g.id === "01502632");
    assert.equal(binghamton.name, "Binghamton");
    assert.equal(binghamton.river, "Susquehanna River");
    assert.equal(binghamton.stage, 2.82);
    assert.equal(binghamton.flow, null);
    assert.deepEqual(binghamton.thresholds, officialFlood["01503500"]);
    assert.equal(windsor.name, "Windsor");
    assert.deepEqual(windsor.thresholds, officialFlood["01502731"]);
    assert.equal(bainbridge.name, "Bainbridge");
    assert.notEqual(bainbridge.name, "Windsor");
    assert.equal([...requested].some(url => url.includes("sites=") && url.includes("01503500")), true);
    assert.equal([...requested].some(url => url.includes("01512780")), false);
    const whitney = data.gauges.find((g: any) => g.id === "01511000");
    assert.equal(whitney.poolElevation, 973.27);
    assert.equal(whitney.poolRangePct, null);
    assert.deepEqual(whitney.thresholds, { action: 1009, minor: 1010 });
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
