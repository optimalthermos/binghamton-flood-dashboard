import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import { registerRoutes } from "../server/routes";

const afd = `Area Forecast Discussion
National Weather Service Binghamton NY
715 PM EDT Mon Sep 21 2026

.WHAT HAS CHANGED...
Rain shifted south of the basin.

.KEY MESSAGES...
No flooding is expected through Thursday.

.DISCUSSION...
A frontal boundary remains south of the area.
`;

const rva = `Hydrologic Summary
National Weather Service Binghamton NY
405 PM EDT Mon Sep 21 2026

Upper Susquehanna Basin
Conklin 12.0 / 3.4 / Non-Flood
`;

async function withServer(fetchImpl: typeof fetch, run: (base: string, request: typeof fetch) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const app = express();
  const server = createServer(app);
  try {
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    await run(`http://127.0.0.1:${address.port}`, originalFetch);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("server source does not ship invented ensemble stages or stale curated alerts", () => {
  const source = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  assert.equal(source.includes("p10: 9.4"), false);
  assert.equal(source.includes("Flood Watch in effect through Wed Apr 1"), false);
});

describe("official text products and groundwater", { concurrency: 1 }, () => {
  test("AFD and river summary keep the product issue time and real section headings", async () => {
    await withServer((async (input: any) => {
      const url = String(input);
      if (url.includes("product=AFD")) return new Response(afd, { status: 200 });
      if (url.includes("product=RVA")) return new Response(rva, { status: 200 });
      throw new Error(`Unexpected test URL: ${url}`);
    }) as typeof fetch, async (base, request) => {
      const response = await request(`${base}/api/forecast`);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.afd.issuedAt, "715 PM EDT Mon Sep 21 2026");
      assert.equal(data.riverSummary.issuedAt, "405 PM EDT Mon Sep 21 2026");
      assert.deepEqual(data.afd.sections.map((section: any) => section.heading), [
        "WHAT HAS CHANGED", "KEY MESSAGES", "DISCUSSION",
      ]);
      assert.match(data.afd.sections[2].text, /frontal boundary/);
    });
  });

  test("groundwater retries a USGS 503 and keeps the published depth", async () => {
    let attempts = 0;
    await withServer((async (input: any) => {
      const url = String(input);
      if (!url.includes("421556075281602")) throw new Error(`Unexpected test URL: ${url}`);
      attempts += 1;
      if (attempts < 3) return new Response("unavailable", { status: 503 });
      return Response.json({ value: { timeSeries: [{ values: [{ value: [
        { dateTime: "2026-09-22T02:45:00Z", value: "4.4" },
        { dateTime: "2026-09-22T03:45:00Z", value: "4.2" },
      ] }] }] } });
    }) as typeof fetch, async (base, request) => {
      const response = await request(`${base}/api/groundwater`);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.depth, 4.2);
      assert.equal(attempts, 3);
    });
  });
});
