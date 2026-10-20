import assert from "node:assert/strict";
import test from "node:test";

import {buildUsageAlerts} from "../src/reminders/usage-summary.ts";

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


test("FL reminders use the 6/9/15 Season 20 usage policy", () => {
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
