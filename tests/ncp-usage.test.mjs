import assert from "node:assert/strict";
import test from "node:test";

import {ncpUsageAdjustmentsFromRows} from "../src/ncp/usage.ts";

test("active approved NCP rows add one usage per listed slot", () => {
  const adjustments = ncpUsageAdjustmentsFromRows([
    {
      division: "FL",
      mode: "2s",
      slots_json: JSON.stringify(["PLAYERB", "PLAYERD"]),
      voided_at: null,
    },
    {
      division: "FL",
      mode: "3s",
      slots_json: JSON.stringify(["PLAYERD", "PLAYERE", "PLAYERB"]),
      voided_at: null,
    },
  ]);

  const bySlot = new Map(adjustments.map(value => [value.slot, value]));
  assert.deepEqual(bySlot.get("B"), {
    division: "FL",
    slot: "B",
    doubles: 1,
    standard: 1,
    total: 2,
  });
  assert.deepEqual(bySlot.get("D"), {
    division: "FL",
    slot: "D",
    doubles: 1,
    standard: 1,
    total: 2,
  });
  assert.deepEqual(bySlot.get("E"), {
    division: "FL",
    slot: "E",
    doubles: 0,
    standard: 1,
    total: 1,
  });
});

test("voided NCP rows do not affect usage totals", () => {
  const adjustments = ncpUsageAdjustmentsFromRows([
    {
      division: "FL",
      mode: "2s",
      slots_json: JSON.stringify(["PLAYERD", "PLAYERE"]),
      voided_at: "2026-11-21 20:00:00",
    },
    {
      division: "FL",
      mode: "2s",
      slots_json: JSON.stringify(["PLAYERA", "PLAYERB"]),
      voided_at: null,
    },
  ]);

  assert.deepEqual(adjustments, [
    {
      division: "FL",
      slot: "A",
      doubles: 1,
      standard: 0,
      total: 1,
    },
    {
      division: "FL",
      slot: "B",
      doubles: 1,
      standard: 0,
      total: 1,
    },
  ]);
});
