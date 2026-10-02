import {fetchCsvDataset} from "./client";
import {field, numberField, sameText} from "./fields";
import type {CsvRecord} from "./csv";
import type {EligibilityEvent} from "../eligibility-decay";
import type {Env} from "../types";

export interface LeagueEligibilityRule {
  leagueCode: string;
  leagueName: string;
  requirement: number;
}

function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function eventFromRow(row: CsvRecord): EligibilityEvent | null {
  const playerId = field(row, "player_id", "Player ID", "sprocket_player_id");
  const createdDate = dateOnly(field(row, "created_at_est", "Created At EST", "created_at"));
  const points = numberField(row, "scrim_points", "Scrim Points");
  if (!playerId || !createdDate || points === null) return null;
  return {playerId, createdDate, points};
}

function leagueFromRow(row: CsvRecord): LeagueEligibilityRule | null {
  const leagueCode = field(row, "league_code", "League Code");
  const leagueName = field(row, "league_name", "League Name");
  const requirement = numberField(row, "eligibility_requirement", "Eligibility Requirement");
  if (!leagueCode || !leagueName || requirement === null) return null;
  return {leagueCode, leagueName, requirement};
}

export async function getEligibilityEvents(
  env: Env,
  playerId?: string,
): Promise<EligibilityEvent[]> {
  const rows = await fetchCsvDataset(env, "eligibility_data");
  const events = rows
    .map(eventFromRow)
    .filter((event): event is EligibilityEvent => event !== null);
  const filtered = playerId ? events.filter(event => event.playerId === playerId) : events;
  return filtered.sort((left, right) =>
    left.createdDate.localeCompare(right.createdDate) ||
    left.playerId.localeCompare(right.playerId),
  );
}

export async function getLeagueEligibilityRules(env: Env): Promise<LeagueEligibilityRule[]> {
  const rows = await fetchCsvDataset(env, "leagues");
  return rows.map(leagueFromRow).filter((rule): rule is LeagueEligibilityRule => rule !== null);
}

export async function getLeagueEligibilityRequirement(
  env: Env,
  league: string | null,
): Promise<number | null> {
  if (!league) return null;
  const rules = await getLeagueEligibilityRules(env);
  const match = rules.find(rule =>
    sameText(rule.leagueName, league) || sameText(rule.leagueCode, league),
  );
  return match?.requirement ?? null;
}
