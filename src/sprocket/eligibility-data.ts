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

interface EligibilityCachePayload<T> {
  cachedAt: number;
  values: T[];
}

const ELIGIBILITY_CACHE_TTL_MS = 5 * 60_000;
const ELIGIBILITY_EVENTS_CACHE_KEY = "eligibility:events:v1";
const ELIGIBILITY_RULES_CACHE_KEY = "eligibility:rules:v1";

async function readEligibilityCache<T>(
  env: Env,
  key: string,
): Promise<EligibilityCachePayload<T> | null> {
  if (!env.HAGRID_CACHE) return null;
  const raw = await env.HAGRID_CACHE.get(key, "text");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EligibilityCachePayload<T>;
    if (!Number.isFinite(parsed.cachedAt) || !Array.isArray(parsed.values)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeEligibilityCache<T>(
  env: Env,
  key: string,
  values: T[],
): Promise<void> {
  if (!env.HAGRID_CACHE) return;
  try {
    await env.HAGRID_CACHE.put(key, JSON.stringify({cachedAt: Date.now(), values}));
  } catch (error) {
    console.warn("Could not update eligibility KV cache.", error);
  }
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
  const cached = await readEligibilityCache<EligibilityEvent>(env, ELIGIBILITY_EVENTS_CACHE_KEY);
  let events: EligibilityEvent[];

  if (cached && Date.now() - cached.cachedAt <= ELIGIBILITY_CACHE_TTL_MS) {
    events = cached.values;
  } else {
    try {
      const rows = await fetchCsvDataset(env, "eligibility_data");
      events = rows
        .map(eventFromRow)
        .filter((event): event is EligibilityEvent => event !== null);
      await writeEligibilityCache(env, ELIGIBILITY_EVENTS_CACHE_KEY, events);
    } catch (error) {
      if (!cached) throw error;
      console.warn("Eligibility event source unavailable; using stale KV snapshot.", error);
      events = cached.values;
    }
  }

  const filtered = playerId ? events.filter(event => event.playerId === playerId) : events;
  return filtered.sort((left, right) =>
    left.createdDate.localeCompare(right.createdDate) ||
    left.playerId.localeCompare(right.playerId),
  );
}

export async function getLeagueEligibilityRules(env: Env): Promise<LeagueEligibilityRule[]> {
  const cached = await readEligibilityCache<LeagueEligibilityRule>(env, ELIGIBILITY_RULES_CACHE_KEY);
  if (cached && Date.now() - cached.cachedAt <= ELIGIBILITY_CACHE_TTL_MS) {
    return cached.values;
  }

  try {
    const rows = await fetchCsvDataset(env, "leagues");
    const rules = rows.map(leagueFromRow).filter((rule): rule is LeagueEligibilityRule => rule !== null);
    await writeEligibilityCache(env, ELIGIBILITY_RULES_CACHE_KEY, rules);
    return rules;
  } catch (error) {
    if (!cached) throw error;
    console.warn("Eligibility rule source unavailable; using stale KV snapshot.", error);
    return cached.values;
  }
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
