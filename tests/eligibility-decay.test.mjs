import assert from "node:assert/strict";
import test from "node:test";

import {buildEligibilityDecay} from "../src/eligibility-decay.ts";

test("eligibility points remain active through 30 days after the scrim", () => {
  const points = buildEligibilityDecay(
    [{playerId: "1", createdDate: "2026-09-01", points: 30}],
    30,
    "2026-09-28",
  );
  const byDate = new Map(points.map(point => [point.date, point]));
  assert.equal(byDate.get("2026-10-01")?.points, 30);
  assert.equal(byDate.get("2026-10-02")?.points, 0);
});

test("Monday eligibility remains locked for the entire league week", () => {
  const points = buildEligibilityDecay(
    [{playerId: "1", createdDate: "2026-09-01", points: 30}],
    30,
    "2026-09-30",
  );
  const byDate = new Map(points.map(point => [point.date, point]));

  assert.equal(byDate.get("2026-09-28")?.eligible, true);
  assert.equal(byDate.get("2026-10-02")?.points, 0);
  assert.equal(byDate.get("2026-10-02")?.eligible, true);
  assert.equal(byDate.get("2026-10-04")?.eligible, true);
  assert.equal(byDate.get("2026-10-05")?.eligible, false);
});

test("earning enough points after Monday does not unlock that week retroactively", () => {
  const points = buildEligibilityDecay(
    [{playerId: "1", createdDate: "2026-09-29", points: 30}],
    30,
    "2026-09-30",
  );
  const byDate = new Map(points.map(point => [point.date, point]));

  assert.equal(byDate.get("2026-09-28")?.eligible, false);
  assert.equal(byDate.get("2026-09-30")?.points, 30);
  assert.equal(byDate.get("2026-10-04")?.eligible, false);
  assert.equal(byDate.get("2026-10-05")?.eligible, true);
});
