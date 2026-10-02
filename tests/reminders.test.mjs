import assert from "node:assert/strict";
import test from "node:test";

import {daysUntil, easternHour, normalReminderDue, parseReminderDate, reminderDue} from "../src/reminders/logic.ts";

test("reminder dates accept US and ISO forms", () => {
  assert.equal(parseReminderDate("10/24/26"), "2026-10-24");
  assert.equal(parseReminderDate("10/24/2026"), "2026-10-24");
  assert.equal(parseReminderDate("2026-10-24"), "2026-10-24");
  assert.equal(parseReminderDate("2/30/2026"), null);
});

test("normal reminder cadence is anchored to deadline every two days", () => {
  assert.equal(daysUntil("2026-10-24", "2026-10-20"), 4);
  assert.equal(normalReminderDue("2026-10-24", "2026-10-20"), true);
  assert.equal(normalReminderDue("2026-10-24", "2026-10-21"), false);
  assert.equal(normalReminderDue("2026-10-24", "2026-10-22"), true);
  assert.equal(normalReminderDue("2026-10-24", "2026-10-24"), true);
  assert.equal(normalReminderDue("2026-10-24", "2026-10-25"), false);
});


test("reminder send hour is evaluated in Eastern time", () => {
  assert.equal(easternHour(new Date("2026-10-24T17:00:00Z")), 13);
  assert.equal(easternHour(new Date("2026-12-24T18:00:00Z")), 13);
});


test("daily and once reminder cadences respect the deadline", () => {
  assert.equal(reminderDue("daily", "2026-10-24", "2026-10-22"), true);
  assert.equal(reminderDue("daily", "2026-10-24", "2026-10-24"), true);
  assert.equal(reminderDue("daily", "2026-10-24", "2026-10-25"), false);
  assert.equal(reminderDue("once", "2026-10-24", "2026-10-23"), false);
  assert.equal(reminderDue("once", "2026-10-24", "2026-10-24"), true);
});
