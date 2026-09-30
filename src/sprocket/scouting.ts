import {fetchCsvDataset, fetchLegacyCsvDataset} from "./client";
import {field, integerField, numberField} from "./fields";
import type {CsvRecord} from "./csv";
import type {Env} from "../types";
import type {
  LeagueCode,
  ProspectIdentity,
  ProspectStatus,
  RawScoutingLine,
  ScoutingMode,
} from "../scouting/calculate";

export function leagueCode(value: string | null): LeagueCode | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "fl" || normalized.includes("foundation")) return "FL";
  if (normalized === "al" || normalized.includes("academy")) return "AL";
  if (normalized === "cl" || normalized.includes("champion")) return "CL";
  if (normalized === "ml" || normalized.includes("master")) return "ML";
  if (normalized === "pl" || normalized.includes("premier")) return "PL";
  return null;
}

export function prospectStatus(value: string | null): ProspectStatus | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleUpperCase("en-US");
  if (normalized === "FA" || normalized === "FREE AGENT" || normalized === "FREE AGENTS") {
    return "FA";
  }
  if (normalized === "PEND" || normalized === "PENDING" || normalized === "PEND.") {
    return "PEND";
  }
  return null;
}

export function scoutingMode(value: string | null): ScoutingMode | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (["2s", "2v2", "doubles", "double"].includes(normalized)) return "2s";
  if (["3s", "3v3", "standard"].includes(normalized)) return "3s";
  return null;
}

function percentField(row: CsvRecord, ...keys: string[]): number | null {
  const raw = field(row, ...keys);
  if (raw === null) return null;
  if (raw.endsWith("%")) {
    const value = Number(raw.slice(0, -1));
    return Number.isFinite(value) ? value / 100 : null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function identityFromRow(row: CsvRecord): ProspectIdentity | null {
  const sprocketPlayerId = field(row, "sprocket_player_id", "Sprocket ID", "Sprocket Player ID");
  const name = field(row, "name", "Name");
  const salary = numberField(row, "salary", "Salary");
  const league = leagueCode(field(row, "skill_group", "Skill Group", "league", "League"));
  const status = prospectStatus(field(row, "franchise", "Franchise", "status", "Status"));

  if (!sprocketPlayerId || !name || !league || !status) return null;
  return {sprocketPlayerId, name, salary, league, status};
}

function statsFromRow(row: CsvRecord): RawScoutingLine | null {
  const sprocketPlayerId = field(row, "sprocket_player_id", "Sprocket ID", "Sprocket Player ID");
  const mode = scoutingMode(field(row, "gamemode", "Gamemode", "game_mode", "Mode"));
  const games = integerField(row, "scrim_games_played", "Scrims", "games", "Games");
  if (!sprocketPlayerId || !mode || games === null || games <= 0) return null;

  return {
    sprocketPlayerId,
    mode,
    league: leagueCode(field(row, "skill_group", "Skill Group", "league", "League")),
    games,
    winPct: percentField(row, "win_percentage", "Win %", "Win%"),
    dpi: numberField(row, "dpi_per_game", "DPI"),
    sprocket: numberField(
      row,
      "Avg_Sprocket_Rating",
      "avg_sprocket_rating",
      "Avg Sprocket",
      "Sprocket",
      "gpi_per_game",
      "GPI",
    ),
    opi: numberField(row, "opi_per_game", "OPI"),
    score: numberField(row, "score_per_game", "Score"),
    goals: numberField(row, "goals_per_game", "Goals"),
    assists: numberField(row, "assists_per_game", "Assists"),
    saves: numberField(row, "saves_per_game", "Saves"),
    shots: numberField(row, "shots_per_game", "Shots"),
    demos: numberField(row, "demos_per_game", "Demos"),
  };
}

export async function getProspectIdentities(env: Env): Promise<ProspectIdentity[]> {
  // The root players.csv remains the status authority used by the legacy MLE tooling:
  // its `franchise` column contains team names as well as FA/Pend/Waivers states.
  const rows = await fetchLegacyCsvDataset(env, "players");
  const values = rows.map(identityFromRow).filter((value): value is ProspectIdentity => value !== null);

  const byId = new Map<string, ProspectIdentity>();
  for (const value of values) byId.set(value.sprocketPlayerId, value);
  return [...byId.values()].sort((left, right) => left.sprocketPlayerId.localeCompare(right.sprocketPlayerId));
}

export async function getScoutingStatLines(env: Env): Promise<RawScoutingLine[]> {
  const rows = await fetchCsvDataset(env, "Avg_Scrim_Stats");
  return rows
    .map(statsFromRow)
    .filter((value): value is RawScoutingLine => value !== null)
    .sort((left, right) =>
      left.sprocketPlayerId.localeCompare(right.sprocketPlayerId) || left.mode.localeCompare(right.mode),
    );
}
