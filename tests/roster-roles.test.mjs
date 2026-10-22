import assert from "node:assert/strict";
import test from "node:test";

import {DIVISION_ROLE_IDS} from "../src/discord-roles.ts";
import {
  isCaptainPosition,
  rosterRoleTarget,
} from "../src/roster-roles.ts";

function player(overrides = {}) {
  return {
    sprocket_player_id: "123",
    discord_id: "443544081696686080",
    skill_group: "Master League",
    staff_position: null,
    slot: "PLAYERA",
    ...overrides,
  };
}

test("competitive players map to their current division role", () => {
  assert.deepEqual(rosterRoleTarget(player()), {
    sprocketPlayerId: "123",
    discordUserId: "443544081696686080",
    divisionRoleId: DIVISION_ROLE_IDS.ML,
    captain: false,
  });

  assert.equal(
    rosterRoleTarget(player({skill_group: "Champion League"}))?.divisionRoleId,
    DIVISION_ROLE_IDS.CL,
  );
});

test("playing captains receive Captain plus their division role", () => {
  const target = rosterRoleTarget(player({
    skill_group: "Academy League",
    staff_position: "Captain",
    slot: "PLAYERB",
  }));

  assert.equal(target?.divisionRoleId, DIVISION_ROLE_IDS.AL);
  assert.equal(target?.captain, true);
  assert.equal(isCaptainPosition("Team Captain"), true);
  assert.equal(isCaptainPosition("CAPT"), true);
});

test("AGM+ positions are never converted into Hagrid-managed staff roles", () => {
  const target = rosterRoleTarget(player({
    skill_group: "Foundation League",
    staff_position: "Assistant General Manager",
    slot: "PLAYERC",
  }));

  assert.equal(target?.divisionRoleId, DIVISION_ROLE_IDS.FL);
  assert.equal(target?.captain, false);
});

test("non-playing staff do not receive a division or Captain role from roster data", () => {
  const target = rosterRoleTarget(player({
    skill_group: "Champion League",
    staff_position: "General Manager",
    slot: null,
  }));

  assert.equal(target?.divisionRoleId, null);
  assert.equal(target?.captain, false);
});

test("players without a usable Discord link cannot be reconciled", () => {
  assert.equal(rosterRoleTarget(player({discord_id: null})), null);
});
