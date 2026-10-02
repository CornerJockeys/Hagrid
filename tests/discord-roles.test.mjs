import assert from "node:assert/strict";
import test from "node:test";

import {
  DIVISION_ROLE_IDS,
  STAFF_ROLE_IDS,
  captainDivisions,
  hasAgmPlusRole,
  hasAnyStaffRole,
  hasCaptainRole,
  isCaptainForDivision,
  hasAnyStaffRoleIds,
  hasAgmPlusRoleIds,
  hasCaptainRoleIds,
  captainDivisionsFromRoleIds,
} from "../src/discord-roles.ts";

function interaction(roles = []) {
  return {
    type: 2,
    guild_id: "1",
    member: {user: {id: "42"}, roles},
  };
}

test("FM GM AGM are AGM+ and reminder staff", () => {
  for (const roleId of [STAFF_ROLE_IDS.FM, STAFF_ROLE_IDS.GM, STAFF_ROLE_IDS.AGM]) {
    const value = interaction([roleId]);
    assert.equal(hasAgmPlusRole(value), true);
    assert.equal(hasAnyStaffRole(value), true);
  }
});

test("RL Captain is reminder staff but not AGM+", () => {
  const value = interaction([STAFF_ROLE_IDS.RL_CAPTAIN, DIVISION_ROLE_IDS.CL]);
  assert.equal(hasCaptainRole(value), true);
  assert.equal(hasAnyStaffRole(value), true);
  assert.equal(hasAgmPlusRole(value), false);
  assert.deepEqual(captainDivisions(value), ["CL"]);
  assert.equal(isCaptainForDivision(value, "CL"), true);
  assert.equal(isCaptainForDivision(value, "ML"), false);
});

test("captain division is derived from coupled division role", () => {
  const value = interaction([
    STAFF_ROLE_IDS.RL_CAPTAIN,
    DIVISION_ROLE_IDS.FL,
    DIVISION_ROLE_IDS.ML,
  ]);
  assert.deepEqual(captainDivisions(value), ["FL", "ML"]);
});

test("division role without captain role does not grant captain access", () => {
  const value = interaction([DIVISION_ROLE_IDS.AL]);
  assert.equal(hasCaptainRole(value), false);
  assert.equal(hasAnyStaffRole(value), false);
  assert.deepEqual(captainDivisions(value), []);
});


test("Activity role-ID helpers match interaction authorization", () => {
  const roles = [STAFF_ROLE_IDS.RL_CAPTAIN, DIVISION_ROLE_IDS.ML];
  assert.equal(hasAnyStaffRoleIds(roles), true);
  assert.equal(hasAgmPlusRoleIds(roles), false);
  assert.equal(hasCaptainRoleIds(roles), true);
  assert.deepEqual(captainDivisionsFromRoleIds(roles), ["ML"]);
});

test("Activity AGM+ role IDs grant staff without captain division", () => {
  const roles = [STAFF_ROLE_IDS.GM];
  assert.equal(hasAnyStaffRoleIds(roles), true);
  assert.equal(hasAgmPlusRoleIds(roles), true);
  assert.equal(hasCaptainRoleIds(roles), false);
  assert.deepEqual(captainDivisionsFromRoleIds(roles), []);
});
