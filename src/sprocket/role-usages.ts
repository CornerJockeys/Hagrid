import {fetchCsvDataset} from "./client";
import {field, integerField, sameText} from "./fields";
import type {CsvRecord} from "./csv";
import type {Env} from "../types";

export interface RoleUsage {
  doublesUses: number;
  standardUses: number;
  totalUses: number;
  seasonNumber: number;
  teamName: string;
  league: string;
  role: string;
  sourceAsOf: string | null;
}

function fromRow(row: CsvRecord): RoleUsage | null {
  const seasonNumber = integerField(row, "season_number", "Season Number");
  const teamName = field(row, "team_name", "Team Name");
  const league = field(row, "league", "League");
  const role = field(row, "role", "Role");

  if (seasonNumber === null || !teamName || !league || !role) return null;

  return {
    doublesUses: integerField(row, "doubles_uses", "Doubles Uses") ?? 0,
    standardUses: integerField(row, "standard_uses", "Standard Uses") ?? 0,
    totalUses: integerField(row, "total_uses", "Total Uses") ?? 0,
    seasonNumber,
    teamName,
    league,
    role,
    sourceAsOf: field(row, "as_of", "As Of"),
  };
}

export async function getFranchiseRoleUsages(
  env: Env,
  franchiseName: string,
): Promise<RoleUsage[]> {
  const rows = await fetchCsvDataset(env, "role_usages");
  return rows
    .map(fromRow)
    .filter((usage): usage is RoleUsage =>
      usage !== null && sameText(usage.teamName, franchiseName),
    );
}

export async function getLatestFranchiseRoleUsages(
  env: Env,
  franchiseName: string,
): Promise<RoleUsage[]> {
  const usages = await getFranchiseRoleUsages(env, franchiseName);
  if (usages.length === 0) return [];

  const latestSeason = Math.max(...usages.map(usage => usage.seasonNumber));
  return usages.filter(usage => usage.seasonNumber === latestSeason);
}
