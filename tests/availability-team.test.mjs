import assert from "node:assert/strict";
import test from "node:test";

import {accessFromRosterRow, accessFromRosterRows} from "../src/activity/access.ts";
import {currentEasternWeekStart} from "../src/activity/week.ts";
import {
  aggregateTeamAvailability,
  divisionCode,
  isCompetitiveAvailabilityPlayer,
} from "../src/availability/team.ts";

test("Activity staff access recognizes franchise staff, AGMs, and captains", () => {
  const gm = accessFromRosterRow({
    sprocket_player_id: "1",
    name: "GM",
    skill_group: "Champion League",
    staff_position: "General Manager",
    slot: null,
  });
  assert.equal(gm.rosterMember, true);
  assert.equal(gm.staff, true);

  const agm = accessFromRosterRow({
    sprocket_player_id: "4",
    name: "AGM",
    skill_group: "Academy League",
    staff_position: "Assistant General Manager",
    slot: null,
  });
  assert.equal(agm.rosterMember, true);
  assert.equal(agm.staff, true);

  const agmSlotFallback = accessFromRosterRow({
    sprocket_player_id: "5",
    name: "AGM slot",
    skill_group: "Academy League",
    staff_position: null,
    slot: "AGM",
  });
  assert.equal(agmSlotFallback.staff, true);

  const duplicateIdentity = accessFromRosterRows([
    {
      sprocket_player_id: "6",
      name: "Dual-role",
      skill_group: "Champion League",
      staff_position: null,
      slot: "PLAYERB",
    },
    {
      sprocket_player_id: "7",
      name: "Dual-role",
      skill_group: "Champion League",
      staff_position: "Assistant General Manager",
      slot: "AGM",
    },
  ]);
  assert.equal(duplicateIdentity.staff, true);
  assert.equal(duplicateIdentity.staffPosition, "Assistant General Manager");

  const captain = accessFromRosterRow({
    sprocket_player_id: "2",
    name: "Captain",
    skill_group: "Champion League",
    staff_position: "Captain",
    slot: "PLAYERA",
  });
  assert.equal(captain.staff, true);

  const player = accessFromRosterRow({
    sprocket_player_id: "3",
    name: "Player",
    skill_group: "Champion League",
    staff_position: null,
    slot: "PLAYERB",
  });
  assert.equal(player.staff, false);
});

test("division normalization handles public MLE league names", () => {
  assert.equal(divisionCode("Foundation League"), "FL");
  assert.equal(divisionCode("Academy League"), "AL");
  assert.equal(divisionCode("Champion League"), "CL");
  assert.equal(divisionCode("Master League"), "ML");
  assert.equal(divisionCode("Premier League"), "PL");
});

test("team availability includes PLAYER roster slots and preserves missing/unlinked states", () => {
  const roster = [
    {sprocketPlayerId: "1", discordUserId: "101", name: "Alpha", division: "CL", salary: 12, slot: "PLAYERA", staffPosition: "Captain"},
    {sprocketPlayerId: "2", discordUserId: "102", name: "Bravo", division: "CL", salary: 10, slot: "PLAYERB", staffPosition: null},
    {sprocketPlayerId: "3", discordUserId: null, name: "Charlie", division: "CL", salary: 8, slot: "PLAYERC", staffPosition: null},
    {sprocketPlayerId: "4", discordUserId: "104", name: "Manager", division: "CL", salary: 20, slot: "GM", staffPosition: "General Manager"},
    {sprocketPlayerId: "5", discordUserId: "105", name: "Delta", division: "AL", salary: 7, slot: "PLAYERD", staffPosition: null},
  ];
  assert.equal(isCompetitiveAvailabilityPlayer(roster[0]), true);
  assert.equal(isCompetitiveAvailabilityPlayer(roster[3]), false);

  const submissions = [
    {discordUserId: "101", updatedAt: "2026-09-30T10:00:00Z", slots: [
      {day: 0, minute: 720, state: 1},
      {day: 0, minute: 750, state: 2},
    ]},
    {discordUserId: "102", updatedAt: "2026-09-30T10:05:00Z", slots: []},
    {discordUserId: "105", updatedAt: "2026-09-30T10:10:00Z", slots: [{day: 0, minute: 720, state: 1}]},
  ];

  const summary = aggregateTeamAvailability(roster, submissions, 720, 780, 30, "CL");
  assert.equal(summary.players.length, 3);
  assert.equal(summary.players.find(player => player.name === "Alpha")?.submitted, true);
  assert.equal(summary.players.find(player => player.name === "Bravo")?.submitted, true);
  assert.equal(summary.players.find(player => player.name === "Charlie")?.linked, false);
  assert.deepEqual(summary.missing.map(player => player.name), ["Charlie"]);

  const noon = summary.cells.find(cell => cell.day === 0 && cell.minute === 720);
  assert.ok(noon);
  assert.equal(noon.available, 1);
  assert.equal(noon.preferred, 0);
  assert.equal(noon.submitted, 2);
  assert.equal(noon.roster, 3);

  const twelveThirty = summary.cells.find(cell => cell.day === 0 && cell.minute === 750);
  assert.ok(twelveThirty);
  assert.equal(twelveThirty.available, 1);
  assert.equal(twelveThirty.preferred, 1);
  assert.deepEqual(summary.divisions, ["AL", "CL"]);

  const allTeams = aggregateTeamAvailability(roster, submissions, 720, 780, 30, null);
  assert.equal(allTeams.players.length, 4);
  assert.deepEqual(
    allTeams.players.map(player => player.name).sort(),
    ["Alpha", "Bravo", "Charlie", "Delta"],
  );
});


test("availability week rolls to the new Monday in Eastern time", () => {
  assert.equal(currentEasternWeekStart(new Date("2026-10-12T03:59:00Z")), "2026-10-05");
  assert.equal(currentEasternWeekStart(new Date("2026-10-12T04:01:00Z")), "2026-10-12");
});
