import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { registerRoutes } from "../server/routes";

test("basin traffic cameras proxy 511NY stills and skip video playlists", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const rows = [
    {
      id: 447, location: "NY 17 East of Glenwood Road", roadway: "NY 17", county: "Broome",
      latLng: { geography: { wellKnownText: "POINT (-75.9378 42.1155)" } },
      images: [{ id: 4624, imageUrl: "/map/Cctv/4624", disabled: false }],
    },
    {
      id: 19, location: "US 9 SB @ I-87 Exit 17", roadway: "US 9", county: "Saratoga",
      latLng: { geography: { wellKnownText: "POINT (-73.690416 43.237344)" } },
      images: [{ id: 4438, imageUrl: "/map/Cctv/4438", disabled: false }],
    },
    {
      id: 100, location: "Disabled basin camera", roadway: "I-81", county: "Broome",
      latLng: { geography: { wellKnownText: "POINT (-75.92 42.11)" } },
      images: [{ id: 2, imageUrl: "/map/Cctv/2", disabled: true }],
    },
  ];
  let listAttempts = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    requested.push(`${init?.method || "GET"} ${url}`);
    if (url.includes("/List/GetData/Cameras")) {
      listAttempts += 1;
      if (listAttempts === 1) return new Response("unavailable", { status: 500 });
      const body = JSON.parse(init.body);
      const data = body.start ? [] : rows;
      return Response.json({ recordsFiltered: rows.length, data });
    }
    if (url === "https://511ny.org/map/Cctv/4624") {
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png", "last-modified": "Tue, 22 Sep 2026 04:44:01 GMT" },
      });
    }
    if (url.includes("usgs-nims-images")) {
      return new Response(Uint8Array.from([255, 216, 255, 217]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "last-modified": "Tue, 22 Sep 2026 04:00:00 GMT" },
      });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  }) as typeof fetch;

  const app = express();
  const server = createServer(app);
  try {
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const list = await originalFetch(`${base}/api/webcams`);
    assert.equal(list.status, 200);
    const data = await list.json();
    const traffic = data.cameras.filter((c: any) => c.category === "traffic");
    assert.deepEqual(traffic.map((c: any) => c.name), ["NY 17 East of Glenwood Road"]);
    assert.equal(traffic[0].publishedAt, "Tue, 22 Sep 2026 04:44:01 GMT");
    assert.equal(traffic[0].imageUrl, "/api/webcams/dot/4624");
    assert.equal(data.cameras.some((c: any) => c.type === "usgs"), true);
    assert.equal(data.cameras.some((c: any) => c.id === "nws"), true);
    const image = await originalFetch(`${base}${traffic[0].imageUrl}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(requested.some(url => url.includes("https://511ny.org/map/Cctv/4624")), true);
    assert.equal(requested.some(url => url.includes(".m3u8")), false);
    const usgs = await originalFetch(`${base}/api/webcams/usgs/norwich-staff`);
    assert.equal(usgs.status, 200);
    assert.equal(usgs.headers.get("last-modified"), "Tue, 22 Sep 2026 04:00:00 GMT");
    assert.equal(usgs.headers.get("cache-control"), "no-store");
    assert.equal(listAttempts >= 2, true);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
