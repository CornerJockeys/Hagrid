import {fetchCsvDataset} from "./client";
import {field, integerField} from "./fields";
import type {CsvRecord} from "./csv";
import type {Env} from "../types";

export interface StandingRow {
  ranking: number;
  name: string;
  divisionName: string | null;
  conference: string | null;
  teamWins: number;
  teamLosses: number;
  league: string | null;
  mode: string | null;
  season: string;
  sourceAsOf: string | null;
}

function fromRow(row: CsvRecord): StandingRow | null {
  const ranking = integerField(row, "ranking", "Ranking");
  const name = field(row, "name", "Name");
  const teamWins = integerField(row, "team_wins", "Team Wins");
  const teamLosses = integerField(row, "team_losses", "Team Losses");
  const season = field(row, "season", "Season");

  if (ranking === null || !name || teamWins === null || teamLosses === null || !season) {
    return null;
  }

  return {
    ranking,
    name,
    divisionName: field(row, "division_name", "Division"),
    conference: field(row, "conference", "Conference"),
    teamWins,
    teamLosses,
    league: field(row, "league", "League"),
    mode: field(row, "mode", "Mode"),
    season,
    sourceAsOf: field(row, "as_of", "As Of"),
  };
}

export function seasonNumber(season: string): number | null {
  const matches = season.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const parsed = Number(matches[matches.length - 1]);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function getStandings(env: Env): Promise<StandingRow[]> {
  const rows = await fetchCsvDataset(env, "standings");
  return rows.map(fromRow).filter((row): row is StandingRow => row !== null);
}

export async function getLatestStandings(env: Env): Promise<StandingRow[]> {
  const rows = await getStandings(env);
  if (rows.length === 0) return [];

  const numbered = rows
    .map(row => ({row, number: seasonNumber(row.season)}))
    .filter((entry): entry is {row: StandingRow; number: number} => entry.number !== null);

  if (numbered.length === 0) {
    const latestLabel = rows[rows.length - 1].season;
    return rows.filter(row => row.season === latestLabel);
  }

  const latestNumber = Math.max(...numbered.map(entry => entry.number));
  return numbered.filter(entry => entry.number === latestNumber).map(entry => entry.row);
}
