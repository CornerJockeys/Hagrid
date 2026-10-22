import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MEMBER_ACCESS_ROLE_ID,
  isPendingRecentMember,
  shouldAssignAccessRole,
} from "../src/auto-role.ts";

const cutoff = "2026-10-21T12:00:00.000Z";

function member(overrides = {}) {
  return {
    joined_at: "2026-10-21T12:05:00.000Z",
    pending: false,
    roles: [],
    user: {id: "123456789012345678", username: "new-member", bot: false},
    ...overrides,
  };
}

test("new human members missing the access role are targeted", () => {
  assert.equal(
    shouldAssignAccessRole(member(), cutoff, DEFAULT_MEMBER_ACCESS_ROLE_ID),
    true,
  );
});

test("existing role holders, bots, and older members are not targeted", () => {
  assert.equal(
    shouldAssignAccessRole(
      member({roles: [DEFAULT_MEMBER_ACCESS_ROLE_ID]}),
      cutoff,
      DEFAULT_MEMBER_ACCESS_ROLE_ID,
    ),
    false,
  );
  assert.equal(
    shouldAssignAccessRole(
      member({user: {id: "123456789012345678", username: "bot", bot: true}}),
      cutoff,
      DEFAULT_MEMBER_ACCESS_ROLE_ID,
    ),
    false,
  );
  assert.equal(
    shouldAssignAccessRole(
      member({joined_at: "2026-10-21T11:59:59.000Z"}),
      cutoff,
      DEFAULT_MEMBER_ACCESS_ROLE_ID,
    ),
    false,
  );
});

test("pending Membership Screening members hold the cutoff open but do not receive the role yet", () => {
  const pending = member({pending: true});
  assert.equal(
    shouldAssignAccessRole(pending, cutoff, DEFAULT_MEMBER_ACCESS_ROLE_ID),
    false,
  );
  assert.equal(isPendingRecentMember(pending, cutoff), true);
});
