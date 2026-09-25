import test from "node:test";
import assert from "node:assert/strict";
import { isWeatherReport } from "../shared/community";

test("local reports keep flooding, rain, and weather posts", () => {
  assert.equal(isWeatherReport("Susquehanna is flooding Front Street"), true);
  assert.equal(isWeatherReport("Heavy rain tonight"), true);
  assert.equal(isWeatherReport("Weather looks rough this weekend"), true);
  assert.equal(isWeatherReport("Creek is up behind the plaza"), true);
  assert.equal(isWeatherReport("It was dumping rain today. My basement is flooding."), true);
});

test("unrelated local posts are not weather reports", () => {
  assert.equal(isWeatherReport("Best pizza in Binghamton?"), false);
  assert.equal(isWeatherReport("Lost dog near the university"), false);
  assert.equal(isWeatherReport("Concert downtown Saturday"), false);
  assert.equal(isWeatherReport("Looking at Twin Rivers, Summit Chase and 50 Front"), false);
  assert.equal(isWeatherReport(""), false);
});
