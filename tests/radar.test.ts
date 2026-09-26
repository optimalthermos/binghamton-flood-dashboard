import test from "node:test";
import assert from "node:assert/strict";
import { BASIN_CENTER, BROOME_COUNTY, fitCounty, markerPercent, radarLayer, radarOverlayUrl, radarTileUrl, viewExtent } from "../shared/radar";

test("radar view frames Broome County and leaves distant states outside", () => {
  const view = fitCounty();
  const extent = viewExtent(view);
  const binghamton = markerPercent(BASIN_CENTER.latitude, BASIN_CENTER.longitude, view);
  assert.ok(binghamton.left > 5 && binghamton.left < 95);
  assert.ok(binghamton.top > 5 && binghamton.top < 95);
  assert.ok(extent.north >= BROOME_COUNTY.north);
  assert.ok(extent.south <= BROOME_COUNTY.south);
  assert.ok(extent.west <= BROOME_COUNTY.west);
  assert.ok(extent.east >= BROOME_COUNTY.east);
  const stateCollege = markerPercent(40.7934, -77.86, view);
  const albany = markerPercent(42.6526, -73.7562, view);
  assert.ok(stateCollege.left < 0 || stateCollege.left > 100 || stateCollege.top < 0 || stateCollege.top > 100);
  assert.ok(albany.left < 0 || albany.left > 100 || albany.top < 0 || albany.top > 100);
});

test("radar frames use the mercator loop layers and the geographic WMS layer is not mixed in", () => {
  assert.equal(radarLayer(0), "nexrad-n0q-900913");
  assert.equal(radarLayer(5), "nexrad-n0q-900913-m05m");
  const url = radarTileUrl(0, 9, 148, 189);
  assert.match(url, /nexrad-n0q-900913\/9\/148\/189\.png$/);
  const overlay = radarOverlayUrl(0, fitCounty());
  assert.match(overlay, /SRS=EPSG%3A3857|SRS=EPSG:3857/);
  assert.match(overlay, /nexrad-n0q-900913/);
  assert.equal(overlay.includes("EPSG:4326"), false);
});
