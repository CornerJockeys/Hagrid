import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateMatchStatLines,
  aggregatePlayerSeries,
  normalizeMatchMode,
  playerMatchGamesForMode,
} from "../src/sprocket/match-stats.ts";

function game(overrides = {}) {
  return {
    memberId: "100",
    teamName: "Wizards",
    skillGroup: "Master League",
    mode: "3s",
    matchId: "42",
    roundId: "1",
    submittedAt: "2026-11-14T01:00:00Z",
    homeWon: true,
    dpi: 40,
    gpi: 50,
    opi: 60,
    goals: 1,
    saves: 2,
    score: 500,
    shots: 4,
    assists: 1,
    goalsAgainst: 2,
    shotsAgainst: 8,
    demosInflicted: 1,
    demosTaken: 0,
    ...overrides,
  };
}

const match = {
  matchId: "42",
  fixtureId: "7",
  matchGroupId: "3",
  schedulingStartTime: "2026-11-12T00:00:00Z",
  schedulingEndTime: "2026-11-16T00:00:00Z",
  scheduledTime: "2026-11-14T01:00:00Z",
  home: "Wizards",
  away: "Spectre",
  league: "Master League",
  mode: "3s",
  homeWins: 4,
  awayWins: 1,
  winningTeam: "Wizards",
};

test("match mode normalization handles Sprocket descriptions and codes", () => {
  assert.equal(normalizeMatchMode("Doubles"), "2s");
  assert.equal(normalizeMatchMode("RL_DOUBLES"), "2s");
  assert.equal(normalizeMatchMode("2v2"), "2s");
  assert.equal(normalizeMatchMode("Standard"), "3s");
  assert.equal(normalizeMatchMode("RL_STANDARD"), "3s");
  assert.equal(normalizeMatchMode("3s"), "3s");
  assert.equal(normalizeMatchMode("Hoops"), null);
});

test("official match aggregates average per-game player performance", () => {
  const lines = aggregateMatchStatLines([
    game(),
    game({
      roundId: "2",
      homeWon: false,
      gpi: 70,
      opi: 80,
      dpi: 60,
      score: 700,
      goals: 3,
      assists: 2,
      saves: 4,
      shots: 6,
      demosInflicted: 3,
    }),
  ], [match]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].mode, "3s");
  assert.equal(lines[0].games, 2);
  assert.equal(lines[0].winPct, 0.5);
  assert.equal(lines[0].gpi, 60);
  assert.equal(lines[0].opi, 70);
  assert.equal(lines[0].dpi, 50);
  assert.equal(lines[0].score, 600);
  assert.equal(lines[0].goals, 2);
  assert.equal(lines[0].demos, 2);
});

test("player series drill-down preserves opponent, series result, participation, and totals", () => {
  const series = aggregatePlayerSeries([
    game(),
    game({
      roundId: "2",
      homeWon: false,
      goals: 2,
      assists: 0,
      saves: 1,
      shots: 5,
      demosInflicted: 2,
    }),
  ], [match]);

  assert.equal(series.length, 1);
  assert.equal(series[0].matchId, "42");
  assert.equal(series[0].opponent, "Spectre");
  assert.equal(series[0].result, "W");
  assert.equal(series[0].teamWins, 4);
  assert.equal(series[0].opponentWins, 1);
  assert.equal(series[0].gamesPlayed, 2);
  assert.equal(series[0].gameWins, 1);
  assert.equal(series[0].gameLosses, 1);
  assert.equal(series[0].goals, 3);
  assert.equal(series[0].assists, 1);
  assert.equal(series[0].saves, 3);
  assert.equal(series[0].shots, 9);
  assert.equal(series[0].demos, 3);
});

test("away-team round outcomes are inverted correctly", () => {
  const awayMatch = {...match, home: "Spectre", away: "Wizards", homeWins: 2, awayWins: 3, winningTeam: "Wizards"};
  const lines = aggregateMatchStatLines([
    game({homeWon: false}),
    game({roundId: "2", homeWon: true}),
    game({roundId: "3", homeWon: false}),
  ], [awayMatch]);

  assert.equal(lines[0].winPct, 2 / 3);
});


test("player match popup filtering excludes the other mode", () => {
  const games = [
    game({memberId: "100", mode: "2s", matchId: "1", roundId: "1"}),
    game({memberId: "100", mode: "2s", matchId: "2", roundId: "2"}),
    game({memberId: "100", mode: "3s", matchId: "3", roundId: "3"}),
    game({memberId: "200", mode: "2s", matchId: "4", roundId: "4"}),
  ];

  const doubles = playerMatchGamesForMode(games, "100", "2s");
  const standard = playerMatchGamesForMode(games, "100", "3s");

  assert.deepEqual(doubles.map(value => value.matchId), ["1", "2"]);
  assert.deepEqual(standard.map(value => value.matchId), ["3"]);
});
