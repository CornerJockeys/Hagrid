import assert from "node:assert/strict";
import test from "node:test";

import {
  activePointsOnDate,
  eligibilityNeedSteps,
  formatEligibilityNeed,
  formatShortDate,
  inferScrimPointAward,
  mondayOfDate,
} from "../src/reminders/eligibility-summary.ts";

test("eligibility reminder uses the target match week's Monday", () => {
  assert.equal(mondayOfDate("2026-10-24"), "2026-10-19");
  assert.equal(formatShortDate("2026-10-24"), "10/24/26");
});

test("scrim award is inferred from the most common positive ledger award", () => {
  assert.equal(inferScrimPointAward([
    {playerId: "1", createdDate: "2026-10-01", points: 3},
    {playerId: "2", createdDate: "2026-10-01", points: 3},
    {playerId: "3", createdDate: "2026-10-01", points: 5},
    {playerId: "4", createdDate: "2026-10-01", points: -3},
  ]), 3);
});

test("active points follow 30-day inclusive eligibility decay", () => {
  const events = [{playerId: "1", createdDate: "2026-09-19", points: 6}];
  assert.equal(activePointsOnDate(events, "2026-10-19"), 6);
  assert.equal(activePointsOnDate(events, "2026-10-20"), 0);
});

test("eligibility reminder shows a higher scrim need after point decay", () => {
  const events = [
    {playerId: "1", createdDate: "2026-09-19", points: 24},
    {playerId: "1", createdDate: "2026-09-20", points: 3},
  ];
  const steps = eligibilityNeedSteps(events, 30, 3, "2026-10-24", "2026-10-02");
  assert.deepEqual(steps, [
    {date: "2026-10-19", scrims: 1},
    {date: "2026-10-20", scrims: 9},
    {date: "2026-10-21", scrims: 10},
  ]);
  const formatted = formatEligibilityNeed(steps, "2026-10-24");
  assert.equal(formatted?.hasDecayChange, true);
  assert.match(formatted?.text ?? "", /needs 1 scrim by 10\/19\/26/);
  assert.match(formatted?.text ?? "", /9 scrims if not done by 10\/20\/26/);
});
