import test from "node:test";
import assert from "node:assert/strict";
import { norEasterBrief } from "../shared/noreaster";

const sample = `
.KEY MESSAGES...
1) Steady light rain moves in from the southeast Saturday
afternoon associated with the Nor\`Easter off the coast. The
slow-moving low pressure will toss a broad area of rain over
northeast PA and central NY on Sunday.

&&

.DISCUSSION...
KEY MESSAGE 1...

This Nor\`Easter is expected to hug the NJ coast Sunday.
The bulk of the rain for central NY and ne PA is expected to
fall on Sunday. Probabilities for a quarter of an inch of rain
on Sunday support this amount over almost the entire forecast
area, while heavier amounts focus on the Catskills.

KEY MESSAGE 2...

High pressure builds in Tuesday.
`;

test("a nor'easter discussion keeps the official key message", () => {
  const brief = norEasterBrief(sample);
  assert.ok(brief);
  assert.match(brief.headline, /Nor.Easter/);
  assert.match(brief.detail, /quarter of an inch/);
  assert.equal(brief.detail.includes("KEY MESSAGE 2"), false);
});

test("quiet discussions do not invent a nor'easter", () => {
  assert.equal(norEasterBrief("High pressure. No rain expected."), null);
});
