import assert from "node:assert/strict";
import test from "node:test";

import {parseReplayHeader, property, stringProperty, intProperty} from "../src/replay/header.ts";
import {rateReplayPlayers, resolveReplayTeamSize} from "../src/replay/metrics.ts";

const encoder = new TextEncoder();

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function i32(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setInt32(0, value, true);
  return output;
}

function u32(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function asciiString(value) {
  const bytes = encoder.encode(value);
  return concat(i32(bytes.byteLength + 1), bytes, new Uint8Array([0]));
}

function text(value) {
  return asciiString(value);
}

function prop(key, kind, value) {
  return concat(asciiString(key), asciiString(kind), u32(value.byteLength), u32(0), value);
}

function intProp(key, value) {
  return prop(key, "IntProperty", i32(value));
}

function strProp(key, value) {
  return prop(key, "StrProperty", text(value));
}

function boolProp(key, value) {
  return prop(key, "BoolProperty", new Uint8Array([value ? 1 : 0]));
}

function dictionary(...properties) {
  return concat(...properties, asciiString("None"));
}

function player(name, team, score, goals, assists, saves, shots) {
  return dictionary(
    strProp("Name", name),
    intProp("Team", team),
    intProp("Score", score),
    intProp("Goals", goals),
    intProp("Assists", assists),
    intProp("Saves", saves),
    intProp("Shots", shots),
    boolProp("bBot", false),
  );
}

function arrayProp(key, rows) {
  const value = concat(i32(rows.length), ...rows);
  return prop(key, "ArrayProperty", value);
}

function syntheticReplay() {
  const body = concat(
    i32(868),
    i32(34),
    i32(12),
    text("TAGame.Replay_Soccar_TA"),
    dictionary(
      intProp("TeamSize", 2),
      intProp("Team0Score", 2),
      intProp("Team1Score", 1),
      strProp("Id", "TEST-REPLAY"),
      arrayProp("PlayerStats", [
        player("Blue One", 0, 500, 1, 1, 2, 4),
        player("Orange One", 1, 300, 1, 0, 1, 3),
      ]),
    ),
  );

  return concat(i32(body.byteLength), u32(0), body).buffer;
}

test("replay header parser extracts modern PlayerStats arrays", () => {
  const header = parseReplayHeader(syntheticReplay());
  assert.equal(header.majorVersion, 868);
  assert.equal(header.minorVersion, 34);
  assert.equal(header.netVersion, 12);
  assert.equal(header.gameType, "TAGame.Replay_Soccar_TA");
  assert.equal(intProperty(header.properties, "TeamSize"), 2);
  assert.equal(stringProperty(header.properties, "Id"), "TEST-REPLAY");

  const stats = property(header.properties, "PlayerStats");
  assert.ok(stats && stats.type === "array");
  assert.equal(stats.value.length, 2);
  assert.equal(stringProperty(stats.value[0], "Name"), "Blue One");
  assert.equal(intProperty(stats.value[0], "Team"), 0);
});

test("Sprocket 3s ratings match the known regression replay values", () => {
  const players = [
    {name: "rex", team: 1, score: 198, goals: 0, assists: 1, saves: 1, shots: 2, bot: false, onlineId: null, platform: null},
    {name: "ChilledPanda117", team: 1, score: 216, goals: 0, assists: 0, saves: 1, shots: 3, bot: false, onlineId: null, platform: null},
    {name: "koloa", team: 0, score: 398, goals: 0, assists: 1, saves: 3, shots: 1, bot: false, onlineId: null, platform: null},
    {name: "awaree.", team: 1, score: 713, goals: 3, assists: 0, saves: 2, shots: 5, bot: false, onlineId: null, platform: null},
    {name: "AK-47_SENATRA", team: 0, score: 382, goals: 1, assists: 0, saves: 2, shots: 4, bot: false, onlineId: null, platform: null},
    {name: "WhySoBad-0", team: 0, score: 435, goals: 1, assists: 1, saves: 1, shots: 1, bot: false, onlineId: null, platform: null},
  ];

  const rated = rateReplayPlayers(players, 3);
  const expected = new Map([
    ["rex", [39.56, 59.43, 49.50]],
    ["ChilledPanda117", [9.29, 59.43, 34.36]],
    ["koloa", [37.03, 65.56, 51.29]],
    ["awaree.", [95.26, 79.16, 87.21]],
    ["AK-47_SENATRA", [38.14, 42.33, 40.24]],
    ["WhySoBad-0", [76.09, 22.07, 49.08]],
  ]);

  for (const player of rated) {
    const row = expected.get(player.name);
    assert.ok(row, `missing expected row for ${player.name}`);
    assert.equal(player.opi?.toFixed(2), row[0].toFixed(2));
    assert.equal(player.dpi?.toFixed(2), row[1].toFixed(2));
    assert.equal(player.sr?.toFixed(2), row[2].toFixed(2));
  }
});



test("rating team-size fallback treats a nonstandard total-player TeamSize as 3v3", () => {
  const players = [
    {name:"Blue A",team:0,score:400,goals:1,assists:1,saves:2,shots:4,bot:false,onlineId:null,platform:null},
    {name:"Blue B",team:0,score:300,goals:1,assists:0,saves:1,shots:3,bot:false,onlineId:null,platform:null},
    {name:"Blue C",team:0,score:250,goals:0,assists:1,saves:1,shots:2,bot:false,onlineId:null,platform:null},
    {name:"Orange A",team:1,score:500,goals:2,assists:1,saves:2,shots:5,bot:false,onlineId:null,platform:null},
    {name:"Orange B",team:1,score:350,goals:1,assists:1,saves:1,shots:3,bot:false,onlineId:null,platform:null},
    {name:"Orange C",team:1,score:220,goals:0,assists:0,saves:2,shots:2,bot:false,onlineId:null,platform:null},
  ];

  const resolved = resolveReplayTeamSize(6, players);
  assert.deepEqual(resolved, {teamSize: 3, inferred: true});

  const rated = rateReplayPlayers(players, resolved.teamSize);
  for (const player of rated) {
    assert.notEqual(player.sr, null);
    assert.notEqual(player.opi, null);
    assert.notEqual(player.dpi, null);
  }
});
