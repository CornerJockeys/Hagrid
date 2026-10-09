import {fetchCsvDataset} from "./client";
import {field} from "./fields";
import type {CsvRecord} from "./csv";
import type {Env} from "../types";

export interface PlayerSeasonHistory {
  memberId: string;
  seasons: string[];
}

function historyRow(row: CsvRecord): {memberId: string; season: string} | null {
  const memberId = field(row, "member_id", "Member ID", "memberId");
  const season = field(row, "season", "Season");
  if (!memberId || !season) return null;
  return {memberId, season};
}

export async function getPlayerSeasonHistory(
  env: Env,
  memberIds: readonly string[],
): Promise<PlayerSeasonHistory[]> {
  const wanted = new Set(memberIds.filter(Boolean));
  if (wanted.size === 0) return [];

  const rows = await fetchCsvDataset(env, "historicalAggregatedPlayerStats");
  const seasonsByMember = new Map<string, Set<string>>();

  for (const row of rows) {
    const value = historyRow(row);
    if (!value || !wanted.has(value.memberId)) continue;
    const seasons = seasonsByMember.get(value.memberId) ?? new Set<string>();
    seasons.add(value.season);
    seasonsByMember.set(value.memberId, seasons);
  }

  return [...wanted].map(memberId => ({
    memberId,
    seasons: [...(seasonsByMember.get(memberId) ?? new Set<string>())]
      .sort((a, b) => a.localeCompare(b, "en-US", {numeric: true, sensitivity: "base"})),
  }));
}
