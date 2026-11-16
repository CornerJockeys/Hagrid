import assert from "node:assert/strict";
import test from "node:test";

import {buildHighUsagePlayers, buildUsageAlerts, buildUsagePlayers} from "../src/reminders/usage-summary.ts";

const players = [
  {sprocketPlayerId:"b",memberId:null,discordId:"1",name:"B",salary:0,skillGroup:"Master League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERB",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  {sprocketPlayerId:"c",memberId:null,discordId:"2",name:"C",salary:0,skillGroup:"Master League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERC",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  {sprocketPlayerId:"d",memberId:null,discordId:"3",name:"D",salary:0,skillGroup:"Master League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERD",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  {sprocketPlayerId:"e",memberId:null,discordId:"4",name:"E",salary:0,skillGroup:"Master League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERE",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  {sprocketPlayerId:"h",memberId:null,discordId:"5",name:"H",salary:0,skillGroup:"Master League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERH",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
];

function usage(role,doublesUses,standardUses,totalUses){
  return {doublesUses,standardUses,totalUses,seasonNumber:20,teamName:"Wizards",league:"Master League",role,sourceAsOf:null};
}

test("usage reminders check combined exhaustion before mode leftovers", () => {
  const alerts = buildUsageAlerts("ML", players, [
    usage("B",5,4,9),
    usage("D",2,6,8),
    usage("E",6,6,10),
    usage("H",4,8,12),
  ]);
  const bySlot = new Map(alerts.map(value => [value.slot, value.text]));
  assert.equal(bySlot.get("B"), "has 1 remaining use in 2s. 3 uses overall.");
  assert.equal(bySlot.get("D"), "has 2 uses left in 3s.");
  assert.equal(bySlot.get("E"), "has no remaining uses in 2s. 2 uses left in 3s.");
  assert.equal(bySlot.get("H"), "has no remaining uses.");
});

test("usage reminder omits healthy slots", () => {
  const alerts = buildUsageAlerts("ML", players, [usage("C",2,3,5)]);
  assert.equal(alerts.length, 0);
});


test("four-slot FL reminders retain the 6/9/15 Season 20 usage policy", () => {
  const flPlayers = [
    {sprocketPlayerId:"a",memberId:null,discordId:"10",name:"A",salary:0,skillGroup:"Foundation League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERA",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  ];
  const alerts = buildUsageAlerts("FL", flPlayers, [
    {doublesUses:4,standardUses:8,totalUses:12,seasonNumber:20,teamName:"Wizards",league:"Foundation League",role:"A",sourceAsOf:null},
  ]);
  assert.equal(alerts[0]?.doublesRemaining, 2);
  assert.equal(alerts[0]?.standardRemaining, 1);
  assert.equal(alerts[0]?.combinedRemaining, 3);
});


test("five-slot FL reminders use reduced 6/8/12 limits once slot E is active", () => {
  const flPlayers = [
    {sprocketPlayerId:"a",memberId:null,discordId:"10",name:"A",salary:0,skillGroup:"Foundation League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERA",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
    {sprocketPlayerId:"e",memberId:null,discordId:"11",name:"E",salary:0,skillGroup:"Foundation League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERE",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  ];
  const alerts = buildUsageAlerts("FL", flPlayers, [
    {doublesUses:4,standardUses:7,totalUses:10,seasonNumber:20,teamName:"Wizards",league:"Foundation League",role:"PLAYERA",sourceAsOf:null},
    {doublesUses:0,standardUses:0,totalUses:0,seasonNumber:20,teamName:"Wizards",league:"Foundation League",role:"PLAYERE",sourceAsOf:null},
  ]);
  const a = alerts.find(value => value.slot === "A");
  assert.equal(a?.doublesRemaining, 2);
  assert.equal(a?.standardRemaining, 1);
  assert.equal(a?.combinedRemaining, 2);
});

test("High Usage includes players with two or fewer mode uses remaining", () => {
  const high = buildHighUsagePlayers("ML", players, [
    usage("B",4,4,8),
    usage("C",3,5,8),
    usage("D",2,6,8),
  ]);
  const bySlot = new Map(high.map(value => [value.slot, value]));

  assert.equal(bySlot.has("B"), true);
  assert.equal(bySlot.get("B")?.doublesRemaining, 2);
  assert.equal(bySlot.has("C"), false);
  assert.equal(bySlot.get("D")?.standardRemaining, 2);
});

test("High Usage shows exact five-slot FL limits", () => {
  const flPlayers = [
    {sprocketPlayerId:"a",memberId:null,discordId:"10",name:"A",salary:0,skillGroup:"Foundation League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERA",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
    {sprocketPlayerId:"e",memberId:null,discordId:"11",name:"E",salary:0,skillGroup:"Foundation League",gameId:null,gameTitle:"Rocket League",franchise:"Wizards",staffPosition:null,slot:"PLAYERE",currentScrimPoints:0,eligibleThrough:null,sourceAsOf:null},
  ];
  const high = buildHighUsagePlayers("FL", flPlayers, [
    {doublesUses:4,standardUses:6,totalUses:9,seasonNumber:20,teamName:"Wizards",league:"Foundation League",role:"PLAYERA",sourceAsOf:null},
    {doublesUses:0,standardUses:0,totalUses:0,seasonNumber:20,teamName:"Wizards",league:"Foundation League",role:"PLAYERE",sourceAsOf:null},
  ]);
  const a = high.find(value => value.slot === "A");
  assert.equal(a?.doublesLimit, 6);
  assert.equal(a?.standardLimit, 8);
  assert.equal(a?.combinedLimit, 12);
  assert.equal(a?.doublesRemaining, 2);
  assert.equal(a?.standardRemaining, 2);
  assert.equal(a?.combinedRemaining, 3);
});


test("Overview usage lists every current roster slot and pins high usage first", () => {
  const rosterUsage = buildUsagePlayers("ML", players, [
    usage("B",1,2,3),
    usage("C",3,4,7),
    usage("D",2,7,9),
    usage("E",5,3,8),
  ]);

  assert.deepEqual(
    rosterUsage.map(value => value.slot),
    ["D", "E", "B", "C", "H"],
  );
  assert.equal(rosterUsage[0]?.highUsage, true);
  assert.equal(rosterUsage[1]?.highUsage, true);
  assert.equal(rosterUsage[2]?.highUsage, false);
  assert.equal(rosterUsage.find(value => value.slot === "H")?.doublesUses, 0);
  assert.equal(rosterUsage.find(value => value.slot === "H")?.standardUses, 0);
});

test("Overview usage preserves separate 2s and 3s used/max values for every slot", () => {
  const rosterUsage = buildUsagePlayers("ML", players, [
    usage("B",4,6,10),
  ]);
  const b = rosterUsage.find(value => value.slot === "B");
  assert.equal(b?.doublesUses, 4);
  assert.equal(b?.doublesLimit, 6);
  assert.equal(b?.standardUses, 6);
  assert.equal(b?.standardLimit, 8);
  assert.equal(b?.combinedLimit, 12);
});
