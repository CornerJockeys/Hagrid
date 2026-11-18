import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilityCopyLines,
  availabilityCopyRangeLines,
  availabilityCopyText,
  availabilityTimesCopyText,
} from "../activity/src/availability-copy.ts";

function player(name, slots) {
  return {name, submitted:true, slots};
}

function slots(day, ...minutes) {
  return minutes.map(minute => ({day, minute, state:1}));
}

function slotRange(day, startMinute, endMinute) {
  const values = [];
  for (let minute = startMinute; minute < endMinute; minute += 30) {
    values.push({day, minute, state:1});
  }
  return values;
}

test("2+ player copy output includes division header and qualifying player names", () => {
  const players = [
    player("Player X", slots(3, 1140, 1170, 1200, 1230)),
    player("Player Y", slots(3, 1140, 1170)),
    player("Player Z", slots(3, 1140, 1170, 1200, 1230)),
    player("Player Q", slots(4, 1140, 1170)),
  ];

  const copied = availabilityCopyText(players, "FL", 2, 1140, 1260, 60);

  assert.deepEqual(copied.lines, [
    "Thursday 7pm, Player X, Player Y, Player Z.",
    "Thursday 8pm, Player X, Player Z.",
  ]);
  assert.equal(
    copied.text,
    "Copy of FL 2+ players\n\n" +
      "Thursday 7pm, Player X, Player Y, Player Z.\n" +
      "Thursday 8pm, Player X, Player Z.",
  );
});

test("3+ player copy excludes times with only two available players", () => {
  const players = [
    player("Player X", slots(3, 1140, 1170, 1200, 1230)),
    player("Player Y", slots(3, 1140, 1170)),
    player("Player Z", slots(3, 1140, 1170, 1200, 1230)),
  ];

  const copied = availabilityCopyText(players, "ML", 3, 1140, 1260, 60);

  assert.deepEqual(copied.lines, [
    "Thursday 7pm, Player X, Player Y, Player Z.",
  ]);
  assert.equal(
    copied.text,
    "Copy of ML 3+ players\n\nThursday 7pm, Player X, Player Y, Player Z.",
  );
});

test("30-minute player copy requires availability for the selected half-hour only", () => {
  const players = [
    player("Player X", slots(3, 1140)),
    player("Player Y", slots(3, 1140)),
  ];

  assert.deepEqual(
    availabilityCopyLines(players, 2, 1140, 1200, 30),
    ["Thursday 7pm, Player X, Player Y."],
  );
});

test("time summary merges consecutive qualifying blocks into day ranges", () => {
  const players = [
    player("Player X", [
      ...slotRange(3, 1140, 1320),
      ...slotRange(4, 1080, 1380),
    ]),
    player("Player Y", [
      ...slotRange(3, 1140, 1320),
      ...slotRange(4, 1080, 1380),
    ]),
  ];

  const copied = availabilityTimesCopyText(players, "FL", 2, 1080, 1380, 60);

  assert.deepEqual(copied.lines, [
    "Thursday 7-10pm",
    "Friday 6-11pm",
  ]);
  assert.equal(
    copied.text,
    "Copy of FL 2+ times\n\nThursday 7-10pm\nFriday 6-11pm",
  );
});

test("time summary keeps separate ranges when a qualifying gap exists", () => {
  const players = [
    player("Player X", [
      ...slotRange(3, 1140, 1200),
      ...slotRange(3, 1260, 1320),
    ]),
    player("Player Y", [
      ...slotRange(3, 1140, 1200),
      ...slotRange(3, 1260, 1320),
    ]),
  ];

  assert.deepEqual(
    availabilityCopyRangeLines(players, 2, 1140, 1320, 60),
    [
      "Thursday 7-8pm",
      "Thursday 9-10pm",
    ],
  );
});

test("30-minute time summary merges half-hour blocks cleanly", () => {
  const players = [
    player("Player X", slotRange(3, 1140, 1230)),
    player("Player Y", slotRange(3, 1140, 1230)),
  ];

  assert.deepEqual(
    availabilityCopyRangeLines(players, 2, 1140, 1260, 30),
    ["Thursday 7-8:30pm"],
  );
});
