import assert from "node:assert/strict";
import test from "node:test";

import {buildScoutingRecords} from "../src/scouting/calculate.ts";

const sample = [
  ["4097", "Corle989", "FA", 5.5, 3, .6667, 410.67, 33.31, 30.44, 36.18, 1.67, .33, .67, 3.33, .67, 53.6432, .215, "Warm", "1st", "3rd", true],
  ["5971", "Cake", "PEND", 6.0, 6, .6667, 330.5, 34.75, 34.14, 35.37, .83, .83, 1.17, 1.67, .83, 51.3024, .214, "Cold", "2nd", "1st", true],
  ["6089", "Jify.", "PEND", 6.5, 3, .6667, 458, 44.38, 42.67, 46.09, 1.67, .67, .67, 4.67, 1.67, 60.4774, .359, "Warm", "1st", "2nd", true],
  ["6294", "Big14", "PEND", 7.0, 3, .3333, 373, 41.31, 48.77, 33.85, .33, 1.0, 2.0, 1.67, 0, 52.2688, .223, "Warm", "3rd", "2nd", true],
  ["6155", "Cristian", "PEND", 9.5, 6, .6667, 634.33, 58.71, 55.4, 62.03, 2.33, .83, 2.17, 5.17, 1.17, 54.7391, .556, "Hot", "3rd", "1st", false],
  ["5197", "xerm", "PEND", 10.5, 3, .6667, 591, 52.6, 30.86, 74.33, 2.0, 1.67, .67, 4.67, 0, 44.3682, .445, "Warm", "2nd", "1st", true],
  ["4928", "DRE", "PEND", 10.5, 3, .6667, 485.33, 39.36, 53.49, 25.23, 1.67, 0, 2.0, 4.0, .33, 33.2009, .308, "Warm", "3rd", "1st", true],
];

const identities = sample.map(row => ({
  sprocketPlayerId: row[0],
  name: row[1],
  status: row[2],
  salary: row[3],
  league: "FL",
}));

const lines = sample.map(row => ({
  sprocketPlayerId: row[0],
  mode: "2s",
  league: "FL",
  games: row[4],
  winPct: row[5],
  score: row[6],
  sprocket: row[7],
  dpi: row[8],
  opi: row[9],
  goals: row[10],
  assists: row[11],
  saves: row[12],
  shots: row[13],
  demos: row[14],
}));

function close(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test("HCPB calculations reproduce the S19 FL 2s prospect sample", () => {
  const records = buildScoutingRecords(identities, lines);
  assert.equal(records.length, sample.length);

  for (const expected of sample) {
    const [id, name,,,,,,,,,,,,,, expectedEfficiency, expectedTemp, bucket, mainRole, altRole, lowShots] = expected;
    const record = records.find(value => value.sprocketPlayerId === id);
    assert.ok(record, `missing ${name}`);
    close(record.effSalary, expectedEfficiency, .02, `${name} Eff/Sal`);
    close(record.temp, expectedTemp, .002, `${name} Temp`);
    assert.equal(record.bucket, bucket, `${name} bucket`);
    assert.equal(record.mainRole, mainRole, `${name} main role`);
    assert.equal(record.altRole, altRole, `${name} alt role`);
    assert.match(record.flags, /Low games sample/, `${name} low-games flag`);
    assert.equal(
      record.flags.includes("Low shots sample"),
      lowShots,
      `${name} low-shots flag`,
    );
  }
});

test("HCPB shooting percentage is goals divided by shots", () => {
  const records = buildScoutingRecords(identities, lines);
  const corle = records.find(value => value.sprocketPlayerId === "4097");
  assert.ok(corle);
  close(corle.shotPct, 1.67 / 3.33, 1e-10, "Corle989 SH%");
});

test("sample flags use total shot opportunities rather than per-game shots", () => {
  const prospects = [
    {sprocketPlayerId: "a", name: "Enough2s", status: "FA", salary: 5, league: "FL"},
    {sprocketPlayerId: "b", name: "Low2s", status: "FA", salary: 5, league: "FL"},
    {sprocketPlayerId: "c", name: "Enough3s", status: "FA", salary: 5, league: "FL"},
    {sprocketPlayerId: "d", name: "Low3s", status: "FA", salary: 5, league: "FL"},
  ];
  const statLines = [
    {sprocketPlayerId: "a", mode: "2s", league: "FL", games: 10, winPct: .5, score: 300, sprocket: 50, dpi: 50, opi: 50, goals: 1, assists: .5, saves: 1, shots: 2, demos: 0},
    {sprocketPlayerId: "b", mode: "2s", league: "FL", games: 10, winPct: .5, score: 300, sprocket: 50, dpi: 50, opi: 50, goals: 1, assists: .5, saves: 1, shots: 1.9, demos: 0},
    {sprocketPlayerId: "c", mode: "3s", league: "FL", games: 10, winPct: .5, score: 300, sprocket: 50, dpi: 50, opi: 50, goals: 1, assists: .5, saves: 1, shots: 1.5, demos: 0},
    {sprocketPlayerId: "d", mode: "3s", league: "FL", games: 10, winPct: .5, score: 300, sprocket: 50, dpi: 50, opi: 50, goals: 1, assists: .5, saves: 1, shots: 1.49, demos: 0},
  ];

  const records = buildScoutingRecords(prospects, statLines);
  assert.equal(records.find(value => value.sprocketPlayerId === "a").flags, "");
  assert.match(records.find(value => value.sprocketPlayerId === "b").flags, /Low shots sample/);
  assert.equal(records.find(value => value.sprocketPlayerId === "c").flags, "");
  assert.match(records.find(value => value.sprocketPlayerId === "d").flags, /Low shots sample/);
});
