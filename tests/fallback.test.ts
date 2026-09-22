import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { registerRoutes } from "../server/routes";

test("a USGS 503 falls back to timestamped NOAA observations end to end", async () => {
  const originalFetch = globalThis.fetch;
  const timestamp = new Date(Date.now() - 15 * 60_000).toISOString();
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes("waterservices.usgs.gov")) return new Response("Unavailable", { status: 503 });
    if (url.endsWith("/stageflow")) return Response.json({ observed: {
      primaryName: "Stage", primaryUnits: "ft", secondaryName: "Flow", secondaryUnits: "kcfs",
      data: [{ validTime: timestamp, primary: 3.4, secondary: 1.66 }],
    } });
    if (url.includes("api.water.noaa.gov")) return Response.json({
      flood: { stageUnits: "ft", categories: { action: { stage: 10 }, minor: { stage: 12 } } },
    });
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
    const conklin = data.gauges.find((g: any) => g.id === "01503000");
    assert.equal(conklin.source, "NOAA NWPS");
    assert.equal(conklin.stage, 3.4);
    assert.equal(conklin.flow, 1660);
    assert.equal(conklin.lastUpdated, timestamp);
    assert.match(data.warning, /official NOAA observations/);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
