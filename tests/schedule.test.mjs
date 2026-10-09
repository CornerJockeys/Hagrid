import assert from "node:assert/strict";
import test from "node:test";

import {S20_SCHEDULE_WEEKS} from "../src/schedule/s20.ts";

test("S20 static schedule snapshot has 10 complete scheduled match weeks", () => {
  assert.equal(S20_SCHEDULE_WEEKS.length, 10);

  const expectedTeams = new Set([
    "Foxes","Puffins","Sabres","Tyrants","Comets","Eclipse","Spectre","Wizards",
    "Aviators","Hive","Hurricanes","Jets","Blizzard","Lightning","Shadow","Wolves",
    "Ducks","Hawks","Pirates","Sharks","Demolition","Dodgers","Elite","Flames",
    "Express","Knights","Outlaws","Spartans","Bears","Bulls","Pandas","Rhinos",
  ]);

  // This validates only the published schedule we transcribed. It is not a
  // played-match/results assertion: an NCP still has a scheduled pairing and
  // must never make runtime result ingestion expect 16 completed series.
  for (const week of S20_SCHEDULE_WEEKS) {
    assert.equal(week.matchups.length, 16, `Match ${week.matchWeek}`);
    const seen = new Set();
    for (const matchup of week.matchups) {
      assert.notEqual(matchup.away, matchup.home);
      assert.equal(seen.has(matchup.away), false, `${matchup.away} duplicated in Match ${week.matchWeek}`);
      assert.equal(seen.has(matchup.home), false, `${matchup.home} duplicated in Match ${week.matchWeek}`);
      seen.add(matchup.away);
      seen.add(matchup.home);
    }
    assert.deepEqual([...seen].sort(), [...expectedTeams].sort(), `Match ${week.matchWeek}`);
  }
});

test("S20 schedule alternates supplied division/conference pattern", () => {
  assert.deepEqual(
    S20_SCHEDULE_WEEKS.map(week => week.kind),
    ["Division","Division","Division","Conference","Division","Conference","Division","Conference","Division","Conference"],
  );
});
