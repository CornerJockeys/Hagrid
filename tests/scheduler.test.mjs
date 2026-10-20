import assert from "node:assert/strict";
import test from "node:test";

import {MASTER_CRON, isHourlyRefreshTime} from "../src/scheduler.ts";

test("Hagrid uses one five-minute master cron", () => {
  assert.equal(MASTER_CRON, "*/5 * * * *");
});

test("hourly refresh work only runs on the :20 master-cron tick", () => {
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T09:20:00Z")), true);
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T10:20:00Z")), true);
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T09:15:00Z")), false);
  assert.equal(isHourlyRefreshTime(Date.parse("2026-10-20T09:25:00Z")), false);
});
