import assert from "node:assert/strict";
import test from "node:test";

import {STAFF_ROLE_IDS} from "../src/discord-roles.ts";
import {
  commaRoleList,
  parseRoleAutomationPayload,
  parseRoleIdList,
} from "../src/role-automation-policy.ts";

test("role automation accepts one or many comma-separated role IDs", () => {
  assert.deepEqual(parseRoleIdList("123456789012345678"), [
    "123456789012345678",
  ]);
  assert.deepEqual(
    parseRoleIdList("123456789012345678, 987654321098765432,123456789012345678"),
    ["123456789012345678", "987654321098765432"],
  );
});

test("blank role automation field disables that circumstance", () => {
  assert.deepEqual(parseRoleIdList("   "), []);
});

test("role automation rejects malformed IDs and protected AGM+ roles", () => {
  assert.throws(() => parseRoleIdList("not-a-role"), /valid Discord role ID/);
  assert.throws(
    () => parseRoleIdList(STAFF_ROLE_IDS.AGM),
    /protected/,
  );
  assert.throws(
    () => parseRoleIdList(STAFF_ROLE_IDS.GM),
    /protected/,
  );
  assert.throws(
    () => parseRoleIdList(STAFF_ROLE_IDS.FM),
    /protected/,
  );
});

test("full admin payload preserves each automation circumstance", () => {
  const mappings = parseRoleAutomationPayload({
    new_member: "100000000000000001,100000000000000002",
    FL: "100000000000000003",
    AL: "",
    CL: "100000000000000004",
    ML: "100000000000000005",
    captain: "100000000000000006,100000000000000007",
    former_player: "100000000000000008",
    former_franchise_staff: "100000000000000009,100000000000000010",
  });

  assert.deepEqual(mappings.new_member, [
    "100000000000000001",
    "100000000000000002",
  ]);
  assert.deepEqual(mappings.AL, []);
  assert.deepEqual(mappings.captain, [
    "100000000000000006",
    "100000000000000007",
  ]);
  assert.equal(commaRoleList(mappings.FL), "100000000000000003");
  assert.deepEqual(mappings.former_player, ["100000000000000008"]);
  assert.deepEqual(mappings.former_franchise_staff, [
    "100000000000000009",
    "100000000000000010",
  ]);
});
