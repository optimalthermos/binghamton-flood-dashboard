import test from "node:test";
import assert from "node:assert/strict";
import { isBroomeStormPost, selectStormPosts } from "../shared/stormPosts";

const NOW = Date.parse("2026-09-26T04:00:00Z");

test("an NWS nor'easter post stays in the Broome storm list", () => {
  const text = "Rain showers return this weekend from the Nor'easter spinning off NJ. NEPA/Catskills will have the biggest impacts, with rainfall of 0.5-1.0in expected and winds gusting to 30mph.";
  assert.equal(isBroomeStormPost({ text, createdAt: "2026-09-25T09:59:51Z", author: "NWSBinghamton" }, NOW), true);
});

test("a coastal-only New York City post stays out", () => {
  const text = "A nor'easter is flooding New York City and Boston. The mayor declared a state of emergency.";
  assert.equal(isBroomeStormPost({ text, createdAt: "2026-09-25T12:00:00Z" }, NOW), false);
});

test("a sports Flood mention stays out", () => {
  const text = "Clever vs Buffalo 49-28. Shout out to Brayden Flood #15.";
  assert.equal(isBroomeStormPost({ text, createdAt: "2026-09-26T03:08:20Z" }, NOW), false);
});

test("routine Binghamton observations and posts older than 72 hours stay out", () => {
  assert.equal(isBroomeStormPost({
    text: "Current weather in Binghamton: overcast, wind 5 mph",
    createdAt: "2026-09-25T23:10:48Z",
  }, NOW), false);
  assert.equal(isBroomeStormPost({
    text: "Rain showers are possible Sat and Sun, mostly east of I-81.",
    createdAt: "2026-09-20T00:00:00Z",
  }, NOW), false);
});

test("selectStormPosts keeps the local storm post and its photo", () => {
  const posts = selectStormPosts([
    {
      type: "status",
      id: "1",
      text: "A Nor'easter will impact the area. Rain showers are possible Sat and Sun, mostly east of I-81.",
      created_timestamp: Date.parse("2026-09-24T09:24:14Z") / 1000,
      url: "https://x.com/NWSBinghamton/status/1",
      author: { screen_name: "NWSBinghamton", name: "NWS Binghamton" },
      media: { photos: [{ url: "https://pbs.twimg.com/media/example.jpg" }] },
    },
    {
      type: "status",
      id: "2",
      text: "Nor'easter flooding in New York City tonight.",
      created_at: "Fri Sep 25 18:00:00 +0000 2026",
      author: { screen_name: "NWSBinghamton", name: "NWS Binghamton" },
    },
  ], NOW);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "1");
  assert.equal(posts[0].imageUrl, "https://pbs.twimg.com/media/example.jpg");
  assert.equal(posts[0].author, "NWSBinghamton");
});
