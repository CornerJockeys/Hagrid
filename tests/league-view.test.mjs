import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSalary,
  isCompetitiveSlot,
  slotLabel,
  teamDivision,
  usageForPlayer,
} from "../src/league/view.ts";

const player = {
  sprocket_player_id: "p1",
  member_id: null,
  discord_id: null,
  name: "Example",
  salary: 15.5,
  skill_group: "Champion League",
  game_id: null,
  game_title: "Rocket League",
  franchise_name: "Spectre",
  staff_position: null,
  slot: "PLAYERB",
  current_scrim_points: 30,
  eligible_through: "2026-10-05",
  source_as_of: null,
  refreshed_at: "2026-10-01T00:00:00Z",
};

test("league view normalizes divisions and roster slots", () => {
  assert.equal(teamDivision("Champion League"), "CL");
  assert.equal(teamDivision("ML"), "ML");
  assert.equal(isCompetitiveSlot("PLAYERB"), true);
  assert.equal(isCompetitiveSlot("GM"), false);
  assert.equal(slotLabel("PLAYERB"), "B");
  assert.equal(formatSalary(15.5), "15.5");
});

test("usage resolves by current division and slot", () => {
  const usages = [
    {
      team_name: "Spectre",
      season_number: 20,
      league: "Champion League",
      role: "B",
      doubles_uses: 2,
      standard_uses: 3,
      total_uses: 5,
      source_as_of: null,
      refreshed_at: "2026-10-01T00:00:00Z",
    },
  ];
  assert.equal(usageForPlayer(player, usages)?.total_uses, 5);
});
