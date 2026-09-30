import assert from "node:assert/strict";

import {getFranchises} from "../src/sprocket/franchises.ts";
import {getFranchisePlayers} from "../src/sprocket/players.ts";
import {getLatestFranchiseRoleUsages} from "../src/sprocket/role-usages.ts";
import {getProspectIdentities, getScoutingStatLines} from "../src/sprocket/scouting.ts";
import {getLatestStandings} from "../src/sprocket/standings.ts";

const env = {
  SPROCKET_DATASET_BASE_URL: process.env.SPROCKET_DATASET_BASE_URL,
  SPROCKET_LEGACY_DATASET_BASE_URL: process.env.SPROCKET_LEGACY_DATASET_BASE_URL,
};

function log(label, value) {
  console.log(`${label}: ${value}`);
}

const franchises = await getFranchises(env);
assert.ok(franchises.length > 0, "teams dataset produced zero franchises");
log("Franchises", franchises.length);

const requestedFranchise = (process.env.HAGRID_SMOKE_FRANCHISE || "Wizards").trim();
const franchise = franchises.find(value =>
  value.name.localeCompare(requestedFranchise, "en-US", {sensitivity: "base"}) === 0 ||
  value.code?.localeCompare(requestedFranchise, "en-US", {sensitivity: "base"}) === 0,
);
assert.ok(franchise, `Could not resolve smoke franchise ${requestedFranchise}`);
log("Smoke franchise", `${franchise.name}${franchise.code ? ` (${franchise.code})` : ""}`);

const [players, usages, standings, prospects, scoutingLines] = await Promise.all([
  getFranchisePlayers(env, franchise.name),
  getLatestFranchiseRoleUsages(env, franchise.name),
  getLatestStandings(env),
  getProspectIdentities(env),
  getScoutingStatLines(env),
]);

assert.ok(players.length > 0, `${franchise.name} produced zero Rocket League roster rows`);
assert.ok(
  players.some(player => player.discordId),
  `${franchise.name} roster has no Discord IDs; Activity identity linking would fail`,
);
assert.ok(
  players.some(player => player.slot && /^PLAYER[A-Z0-9]+$/i.test(player.slot)),
  `${franchise.name} roster has no competitive PLAYER* slots`,
);
assert.ok(usages.length > 0, `${franchise.name} produced zero current role-usage rows`);
assert.ok(standings.length > 0, "standings dataset produced zero current rows");
assert.ok(prospects.length > 0, "legacy players dataset produced zero FA/PEND prospects");
assert.ok(scoutingLines.length > 0, "Avg_Scrim_Stats produced zero usable scouting rows");

log("Roster rows", players.length);
log("Current usage rows", usages.length);
log("Current standing rows", standings.length);
log("FA/PEND prospects", prospects.length);
log("Usable scouting rows", scoutingLines.length);

const rosterLeagues = [...new Set(players.map(player => player.skillGroup).filter(Boolean))];
log("Roster skill groups", rosterLeagues.join(", ") || "none");

console.log("Live Sprocket source smoke test passed.");
