import test from "node:test";
import assert from "node:assert/strict";
import { BASIN_CENTER, basinView, markerPercent, radarLayer, radarTileUrl } from "../shared/radar";

test("basin radar is centered on the Binghamton confluence gauge", () => {
  const view = basinView();
  const spot = markerPercent(BASIN_CENTER.latitude, BASIN_CENTER.longitude, view);
  assert.ok(Math.abs(spot.left - 50) < 1);
  assert.ok(Math.abs(spot.top - 50) < 1);
  assert.ok(view.tiles.length >= 4);
});

test("radar frames use the mercator loop layers and the geographic WMS layer is not mixed in", () => {
  assert.equal(radarLayer(0), "nexrad-n0q-900913");
  assert.equal(radarLayer(5), "nexrad-n0q-900913-m05m");
  const url = radarTileUrl(0, 9, 148, 189);
  assert.match(url, /nexrad-n0q-900913\/9\/148\/189\.png$/);
  assert.equal(url.includes("EPSG:4326"), false);
});
