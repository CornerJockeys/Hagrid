import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilityCopyLines,
  availabilityCopyText,
} from "../activity/src/availability-copy.ts";

function player(name, slots) {
  return {name, submitted:true, slots};
}

function slots(day, ...minutes) {
  return minutes.map(minute => ({day, minute, state:1}));
}

test("2+ copy output includes header and only qualifying times", () => {
  const players = [
    player("Player X", slots(3, 1140, 1170, 1200, 1230)),
    player("Player Y", slots(3, 1140, 1170)),
    player("Player Z", slots(3, 1140, 1170, 1200, 1230)),
    player("Player Q", slots(4, 1140, 1170)),
  ];

  const copied = availabilityCopyText(players, 2, 1140, 1260, 60);

  assert.deepEqual(copied.lines, [
    "Thursday 7pm, Player X, Player Y, Player Z.",
    "Thursday 8pm, Player X, Player Z.",
  ]);
  assert.equal(
    copied.text,
    "Copy of 2+ times\n\n" +
      "Thursday 7pm, Player X, Player Y, Player Z.\n" +
      "Thursday 8pm, Player X, Player Z.",
  );
});

test("3+ copy output excludes times with only two available players", () => {
  const players = [
    player("Player X", slots(3, 1140, 1170, 1200, 1230)),
    player("Player Y", slots(3, 1140, 1170)),
    player("Player Z", slots(3, 1140, 1170, 1200, 1230)),
  ];

  const copied = availabilityCopyText(players, 3, 1140, 1260, 60);

  assert.deepEqual(copied.lines, [
    "Thursday 7pm, Player X, Player Y, Player Z.",
  ]);
  assert.equal(
    copied.text,
    "Copy of 3+ times\n\nThursday 7pm, Player X, Player Y, Player Z.",
  );
});

test("30-minute copy requires availability for the selected half-hour only", () => {
  const players = [
    player("Player X", slots(3, 1140)),
    player("Player Y", slots(3, 1140)),
  ];

  assert.deepEqual(
    availabilityCopyLines(players, 2, 1140, 1200, 30),
    ["Thursday 7pm, Player X, Player Y."],
  );
});
