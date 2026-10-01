import assert from "node:assert/strict";
import test from "node:test";

import {eligibilityCalendarDate, isEligibleForWeek} from "../src/eligibility.ts";

test("eligibility week rule treats Monday as eligible for the entire week", () => {
  assert.equal(isEligibleForWeek("2026-09-28", "2026-09-28"), true);
  assert.equal(isEligibleForWeek("09/28/2026 12:00 AM", "2026-09-28"), true);
  assert.equal(isEligibleForWeek("2026-09-29", "2026-09-28"), true);
  assert.equal(isEligibleForWeek("2026-09-27", "2026-09-28"), false);
});

test("explicit timestamps are evaluated on the Eastern calendar date", () => {
  assert.equal(eligibilityCalendarDate("2026-09-28T04:00:00Z"), "2026-09-28");
  assert.equal(isEligibleForWeek("2026-09-28T04:00:00Z", "2026-09-28"), true);

  // Midnight UTC is still Sunday evening in Eastern time.
  assert.equal(eligibilityCalendarDate("2026-09-28T00:00:00Z"), "2026-09-27");
  assert.equal(isEligibleForWeek("2026-09-28T00:00:00Z", "2026-09-28"), false);
});

test("invalid or missing eligibility does not count as eligible", () => {
  assert.equal(isEligibleForWeek(null, "2026-09-28"), false);
  assert.equal(isEligibleForWeek("not-a-date", "2026-09-28"), false);
});
