import assert from "node:assert/strict";
import test from "node:test";

import {
  formerRoleFlags,
  isCaptainPosition,
  isFranchiseStaffPosition,
  rosterRoleTarget,
} from "../src/roster-role-policy.ts";

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

test("competitive players map to their current division circumstance", () => {
  assert.deepEqual(rosterRoleTarget(player()), {
    sprocketPlayerId: "123",
    discordUserId: "443544081696686080",
    division: "ML",
    captain: false,
  });

  assert.equal(
    rosterRoleTarget(player({skill_group: "Champion League"}))?.division,
    "CL",
  );
});

test("playing captains receive Captain plus their division role", () => {
  const target = rosterRoleTarget(player({
    skill_group: "Academy League",
    staff_position: "Captain",
    slot: "PLAYERB",
  }));

  assert.equal(target?.division, "AL");
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

  assert.equal(target?.division, "FL");
  assert.equal(target?.captain, false);
});

test("non-playing staff do not receive a division or Captain role from roster data", () => {
  const target = rosterRoleTarget(player({
    skill_group: "Champion League",
    staff_position: "General Manager",
    slot: null,
  }));

  assert.equal(target?.division, null);
  assert.equal(target?.captain, false);
});

test("players without a usable Discord link cannot be reconciled", () => {
  assert.equal(rosterRoleTarget(player({discord_id: null})), null);
});


test("former franchise staff excludes Captains and recognizes AGM/GM/FM", () => {
  assert.equal(isFranchiseStaffPosition("Captain"), false);
  assert.equal(isFranchiseStaffPosition("AGM"), true);
  assert.equal(isFranchiseStaffPosition("Assistant General Manager"), true);
  assert.equal(isFranchiseStaffPosition("GM"), true);
  assert.equal(isFranchiseStaffPosition("Franchise Manager"), true);
});

test("former-player and former-staff states are independent", () => {
  assert.deepEqual(
    formerRoleFlags({
      wasPlayer: true,
      wasFranchiseStaff: false,
      currentKnown: true,
      currentSameFranchise: false,
      currentCompetitive: true,
      currentFranchiseStaff: false,
    }),
    {formerPlayer: true, formerFranchiseStaff: false},
  );

  assert.deepEqual(
    formerRoleFlags({
      wasPlayer: true,
      wasFranchiseStaff: true,
      currentKnown: true,
      currentSameFranchise: false,
      currentCompetitive: true,
      currentFranchiseStaff: false,
    }),
    {formerPlayer: true, formerFranchiseStaff: true},
  );
});

test("missing current player data does not falsely mark former franchise staff", () => {
  assert.deepEqual(
    formerRoleFlags({
      wasPlayer: true,
      wasFranchiseStaff: true,
      currentKnown: false,
      currentSameFranchise: false,
      currentCompetitive: false,
      currentFranchiseStaff: false,
    }),
    {formerPlayer: true, formerFranchiseStaff: false},
  );
});

test("staying with the franchise in a different capacity can create one former state", () => {
  assert.deepEqual(
    formerRoleFlags({
      wasPlayer: true,
      wasFranchiseStaff: true,
      currentKnown: true,
      currentSameFranchise: true,
      currentCompetitive: false,
      currentFranchiseStaff: true,
    }),
    {formerPlayer: true, formerFranchiseStaff: false},
  );

  assert.deepEqual(
    formerRoleFlags({
      wasPlayer: true,
      wasFranchiseStaff: true,
      currentKnown: true,
      currentSameFranchise: true,
      currentCompetitive: true,
      currentFranchiseStaff: false,
    }),
    {formerPlayer: false, formerFranchiseStaff: true},
  );
});
