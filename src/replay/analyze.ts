import {
  boolProperty,
  idProperty,
  intProperty,
  parseReplayHeader,
  property,
  stringProperty,
  type HeaderEntries,
  type ReplayHeader,
} from "./header";
import {rateReplayPlayers, type RatedReplayPlayer, type ReplayPlayerStats} from "./metrics";

export interface ReplayAnalysis {
  header: ReplayHeader;
  replayId: string | null;
  replayName: string | null;
  date: string | null;
  matchType: string | null;
  teamSize: number;
  team0Score: number;
  team1Score: number;
  players: RatedReplayPlayer[];
  warnings: string[];
}

function intOrZero(entries: HeaderEntries, key: string): number {
  return intProperty(entries, key) ?? 0;
}

function platform(entries: HeaderEntries): string | null {
  const value = property(entries, "Platform");
  if (!value) return null;

  if (value.type === "byte") {
    return value.value?.replace(/^OnlinePlatform_/, "") ?? null;
  }

  if (value.type === "str" || value.type === "name") {
    return value.value.replace(/^OnlinePlatform_/, "");
  }

  return null;
}

function parsePlayer(entries: HeaderEntries): ReplayPlayerStats | null {
  const name = stringProperty(entries, "Name");
  const team = intProperty(entries, "Team");
  if (!name || (team !== 0 && team !== 1)) return null;

  return {
    name,
    team,
    score: intOrZero(entries, "Score"),
    goals: intOrZero(entries, "Goals"),
    assists: intOrZero(entries, "Assists"),
    saves: intOrZero(entries, "Saves"),
    shots: intOrZero(entries, "Shots"),
    bot: boolProperty(entries, "bBot") ?? false,
    onlineId: idProperty(entries, "OnlineID"),
    platform: platform(entries),
  };
}

function inferredTeamSize(players: ReplayPlayerStats[]): number {
  const team0 = players.filter(player => player.team === 0).length;
  const team1 = players.filter(player => player.team === 1).length;
  return Math.max(team0, team1);
}

export function analyzeReplay(buffer: ArrayBuffer): ReplayAnalysis {
  const header = parseReplayHeader(buffer);
  const warnings: string[] = [];

  const stats = property(header.properties, "PlayerStats");
  if (!stats || stats.type !== "array") {
    throw new Error(
      "This replay does not contain a usable PlayerStats header. " +
        "Players who joined or dropped mid-game can also make header stats incomplete.",
    );
  }

  const players: ReplayPlayerStats[] = [];
  let ignoredRows = 0;
  for (const row of stats.value) {
    const player = parsePlayer(row);
    if (player) players.push(player);
    else ignoredRows += 1;
  }

  if (players.length === 0) {
    throw new Error("The replay PlayerStats header did not contain any Team 0/1 players.");
  }

  if (ignoredRows > 0) {
    warnings.push(`${ignoredRows} PlayerStats row(s) without a normal Team 0/1 assignment were ignored.`);
  }

  const team0Count = players.filter(player => player.team === 0).length;
  const team1Count = players.filter(player => player.team === 1).length;
  const inferredSize = inferredTeamSize(players);
  const declaredTeamSize = intProperty(header.properties, "TeamSize") ?? 0;
  let teamSize = declaredTeamSize;

  if (declaredTeamSize <= 0) {
    teamSize = inferredSize;
    warnings.push(`TeamSize was missing; inferred ${teamSize} from PlayerStats.`);
  } else if (declaredTeamSize > 3 && inferredSize >= 1 && inferredSize <= 3) {
    // Some newer/private-lobby replays can expose a TeamSize value that does
    // not represent the per-side competitive size. PlayerStats is a safer
    // fallback for deciding which Sprocket 1s/2s/3s constants to use.
    teamSize = inferredSize;
    warnings.push(
      `Replay TeamSize was ${declaredTeamSize}; inferred ${teamSize}v${teamSize} from PlayerStats for SR/OPI/DPI.`,
    );
  }

  if (team0Count !== team1Count || team0Count !== teamSize || team1Count !== teamSize) {
    warnings.push(
      `PlayerStats contains ${team0Count} Team 0 and ${team1Count} Team 1 player(s) for TeamSize ${teamSize}. ` +
        "The header may be incomplete because of a join/drop or substitution.",
    );
  }

  if (teamSize > 3) {
    warnings.push("SR/OPI/DPI are only calculated for 1s/2s/3s.");
  } else if (teamSize === 1) {
    warnings.push("Sprocket routes 1s through its 2s OPI/DPI constants; Hagrid mirrors that behavior.");
  }

  const ratedPlayers = rateReplayPlayers(players, teamSize);
  const team0Goals = ratedPlayers
    .filter(player => player.team === 0)
    .reduce((sum, player) => sum + player.goals, 0);
  const team1Goals = ratedPlayers
    .filter(player => player.team === 1)
    .reduce((sum, player) => sum + player.goals, 0);

  return {
    header,
    replayId: stringProperty(header.properties, "Id") ?? idProperty(header.properties, "Id"),
    replayName: stringProperty(header.properties, "ReplayName"),
    date: stringProperty(header.properties, "Date"),
    matchType: stringProperty(header.properties, "MatchType"),
    teamSize,
    team0Score: intProperty(header.properties, "Team0Score") ?? team0Goals,
    team1Score: intProperty(header.properties, "Team1Score") ?? team1Goals,
    players: ratedPlayers,
    warnings,
  };
}
