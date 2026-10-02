import assert from "node:assert/strict";

import {fetchLegacyCsvDataset} from "../src/sprocket/client.ts";
import {CURRENT_MLE_SEASON} from "../src/season-policy.ts";
import {getFranchises} from "../src/sprocket/franchises.ts";
import {getEligibilityEvents, getLeagueEligibilityRules} from "../src/sprocket/eligibility-data.ts";
import {getFranchisePlayers, getRocketLeaguePlayers} from "../src/sprocket/players.ts";
import {
  getLatestFranchiseRoleUsages,
  getRoleUsagesForSeason,
} from "../src/sprocket/role-usages.ts";
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

const [players, allPlayers, usages, seasonUsages, standings, prospects, scoutingLines, eligibilityEvents, eligibilityRules] = await Promise.all([
  getFranchisePlayers(env, franchise.name),
  getRocketLeaguePlayers(env),
  getLatestFranchiseRoleUsages(env, franchise.name),
  getRoleUsagesForSeason(env, CURRENT_MLE_SEASON),
  getLatestStandings(env),
  getProspectIdentities(env),
  getScoutingStatLines(env),
  getEligibilityEvents(env),
  getLeagueEligibilityRules(env),
]);

assert.ok(allPlayers.length > 0, "players dataset produced zero Rocket League players league-wide");
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
assert.ok(eligibilityEvents.length > 0, "eligibility_data produced zero usable events");
assert.ok(eligibilityRules.length > 0, "leagues produced zero eligibility rules");
assert.ok(
  eligibilityRules.every(rule => rule.requirement >= 0),
  "league eligibility requirements must be non-negative",
);

if (scoutingLines.length === 0) {
  const rawScouting = await fetchLegacyCsvDataset(env, "Avg_Scrim_Stats");
  log("Raw legacy Avg_Scrim_Stats rows", rawScouting.length);
  if (rawScouting.length > 0) {
    log("Raw legacy Avg_Scrim_Stats columns", Object.keys(rawScouting[0]).join(" | "));
    const modes = [...new Set(rawScouting.map(row => row.gamemode).filter(Boolean))].slice(0, 20);
    const games = [...new Set(rawScouting.map(row => row.scrim_games_played).filter(Boolean))].slice(0, 10);
    log("Raw legacy gamemode values", modes.join(" | ") || "none");
    log("Raw legacy scrim_games_played examples", games.join(" | ") || "none");
  }
}
assert.ok(scoutingLines.length > 0, "Avg_Scrim_Stats produced zero usable scouting rows");

const franchiseNames = new Set(franchises.map(value => value.name.toLocaleLowerCase("en-US")));
const rosteredLeaguePlayers = allPlayers.filter(player =>
  franchiseNames.has(player.franchise.toLocaleLowerCase("en-US")),
);
const scoutingIds = new Set(scoutingLines.map(value => value.sprocketPlayerId));
const rosteredWithScrimStats = rosteredLeaguePlayers.filter(player => scoutingIds.has(player.sprocketPlayerId));

log("League-wide Rocket League players", allPlayers.length);
log("League-wide rostered players", rosteredLeaguePlayers.length);
log("Rostered players with scrim stats", rosteredWithScrimStats.length);
log(`S${CURRENT_MLE_SEASON} usage rows`, seasonUsages.length);
log("Roster rows", players.length);
log("Current usage rows", usages.length);
log("Current standing rows", standings.length);
log("FA/PEND prospects", prospects.length);
log("Usable scouting rows", scoutingLines.length);
log("Eligibility events", eligibilityEvents.length);
log(
  "Eligibility requirements",
  eligibilityRules.map(rule => `${rule.leagueCode}=${rule.requirement}`).join(" | "),
);

const rosterLeagues = [...new Set(players.map(player => player.skillGroup).filter(Boolean))];
log("Roster skill groups", rosterLeagues.join(", ") || "none");

const staffRows = players.filter(player =>
  Boolean(player.staffPosition) || /^(AGM|GM|CAPT|CAPTAIN)$/i.test(player.slot ?? ""),
);
log(
  "Franchise staff rows",
  staffRows.map(player => `${player.name}=${player.staffPosition ?? player.slot ?? "unknown"}`).join(" | ") || "none",
);

console.log("Live Sprocket source smoke test passed.");
