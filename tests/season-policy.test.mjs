import assert from "node:assert/strict";
import test from "node:test";

import {
  capSpaceFromKnownPlayers,
  divisionPolicy,
  s20WeeklyReportKinds,
  teamSalaryFromKnownPlayers,
} from "../src/season-policy.ts";

test("S20 salary policy matches the updated rulebook", () => {
  assert.equal(divisionPolicy("FL").salaryCap, 34.5);
  assert.equal(divisionPolicy("AL").salaryCap, 62.5);
  assert.equal(divisionPolicy("CL").salaryCap, 74.5);
  assert.equal(divisionPolicy("ML").salaryCap, 86.5);
  assert.equal(divisionPolicy("PL").salaryCap, 79.0);

  assert.equal(divisionPolicy("FL").teamSalaryPlayers, 4);
  assert.equal(divisionPolicy("PL").teamSalaryPlayers, 4);
  assert.equal(divisionPolicy("AL").teamSalaryPlayers, 5);
  assert.equal(divisionPolicy("CL").teamSalaryPlayers, 5);
  assert.equal(divisionPolicy("ML").teamSalaryPlayers, 5);
});

test("team salary counts the correct number of highest salaries and permits negative cap space", () => {
  assert.equal(teamSalaryFromKnownPlayers("CL", [16, 15, 14, 13, 12, 11]), 70);
  assert.equal(teamSalaryFromKnownPlayers("FL", [11, 10.5, 9.5, 9, 8]), 40);
  assert.equal(capSpaceFromKnownPlayers("FL", [11, 10.5, 9.5, 9]), -5.5);
});

test("weekly report windows follow S20 operational dates", () => {
  assert.deepEqual(s20WeeklyReportKinds("2026-10-26"), ["eligibility", "salary"]);
  assert.deepEqual(s20WeeklyReportKinds("2026-11-02"), ["eligibility", "salary", "usage"]);
  assert.deepEqual(s20WeeklyReportKinds("2027-01-04"), ["eligibility", "salary", "usage"]);
  assert.deepEqual(s20WeeklyReportKinds("2027-01-11"), ["usage"]);
  assert.deepEqual(s20WeeklyReportKinds("2027-01-25"), []);
  assert.deepEqual(s20WeeklyReportKinds("2027-02-01"), []);
});
