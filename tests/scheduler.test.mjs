import assert from "node:assert/strict";
import test from "node:test";

import {
  MASTER_CRON,
  isHourlyRefreshTime,
  isRulebookWatchTime,
  isRosterRoleReconcileTime,
} from "../src/scheduler.ts";

test("Hagrid uses one ten-minute master cron", () => {
  assert.equal(MASTER_CRON, "*/10 * * * *");
});

test("hourly refresh work only runs on the :20 master-cron tick", () => {
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T09:20:00Z")), true);
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T10:20:00Z")), true);
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T09:10:00Z")), false);
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T09:30:00Z")), false);
});

test("roster role reconciliation runs after the hourly data refresh at :30", () => {
  assert.equal(isRosterRoleReconcileTime(Date.parse("2026-10-20T09:30:00Z")), true);
  assert.equal(isRosterRoleReconcileTime(Date.parse("2026-10-20T10:30:00Z")), true);
  assert.equal(isRosterRoleReconcileTime(Date.parse("2026-10-20T09:20:00Z")), false);
  assert.equal(isRosterRoleReconcileTime(Date.parse("2026-10-20T09:40:00Z")), false);
});

test("rulebook watch checks only once per hour at :20", () => {
  assert.equal(isRulebookWatchTime(Date.parse("2026-10-20T09:20:00Z")), true);
  assert.equal(isRulebookWatchTime(Date.parse("2026-10-20T10:20:00Z")), true);
  assert.equal(isRulebookWatchTime(Date.parse("2026-10-20T09:00:00Z")), false);
  assert.equal(isRulebookWatchTime(Date.parse("2026-10-20T09:40:00Z")), false);
});
