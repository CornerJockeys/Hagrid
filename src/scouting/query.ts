import type {Env} from "../types";
import {getCachedScoutingSnapshot} from "./cache";
import type {
  LeagueCode,
  ProspectStatus,
  ScoutingBucket,
  ScoutingMode,
  ScoutingRecord,
} from "./calculate";

export type ScoutingViewMode = ScoutingMode | "combined";

interface StoredScoutingRow {
  sprocket_player_id: string;
  mode: ScoutingMode;
  league: LeagueCode;
  status: ProspectStatus;
  name: string;
  salary: number | null;
  games: number;
  win_pct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  shot_pct: number | null;
  demos: number | null;
  eff_salary: number | null;
  temp: number;
  temp_score: number;
  bucket: ScoutingBucket;
  main_role: "1st" | "2nd" | "3rd";
  alt_role: "1st" | "2nd" | "3rd";
  role_confidence: "High" | "Med" | "Low";
  flags: string;
}

interface StoredPoolRow {
  sprocket_player_id: string;
  name: string;
  salary: number | null;
  league: LeagueCode;
  status: ProspectStatus;
}

interface StateRow {
  source_hash: string;
  algorithm_version: string;
  refreshed_at: string;
  checked_at: string;
  prospect_count: number;
  row_count: number;
}

export interface ScoutingState {
  sourceHash: string;
  algorithmVersion: string;
  refreshedAt: string;
  checkedAt: string;
  prospectCount: number;
  rowCount: number;
}

export interface ScoutingDisplayRecord extends Omit<ScoutingRecord, "mode"> {
  mode: ScoutingViewMode;
}

export interface ScoutingFilters {
  search?: string | null;
  league?: LeagueCode | null;
  mode?: ScoutingViewMode | null;
  bucket?: ScoutingBucket | null;
  role?: string | null;
  minGames?: number;
  salaryMin?: number | null;
  salaryMax?: number | null;
  hideLowSample?: boolean;
  sort?: "efficiency" | "gpi" | "opi" | "dpi" | "win_pct" | "games" | "salary" | "temp";
  limit?: number;
}

export interface ScoutingListResult {
  rows: ScoutingDisplayRecord[];
  total: number;
  state: ScoutingState | null;
}

function fromStored(row: StoredScoutingRow): ScoutingRecord {
  return {
    sprocketPlayerId: row.sprocket_player_id,
    mode: row.mode,
    league: row.league,
    status: row.status,
    name: row.name,
    salary: row.salary,
    games: row.games,
    winPct: row.win_pct,
    score: row.score,
    sprocket: row.sprocket,
    dpi: row.dpi,
    opi: row.opi,
    goals: row.goals,
    assists: row.assists,
    saves: row.saves,
    shots: row.shots,
    shotPct: row.shot_pct,
    demos: row.demos,
    effSalary: row.eff_salary,
    temp: row.temp,
    tempScore: row.temp_score,
    bucket: row.bucket,
    mainRole: row.main_role,
    altRole: row.alt_role,
    roleConfidence: row.role_confidence,
    flags: row.flags,
  };
}

export async function getScoutingState(env: Env): Promise<ScoutingState | null> {
  const cached = await getCachedScoutingSnapshot(env);
  if (cached) {
    return {
      sourceHash: cached.state.sourceHash,
      algorithmVersion: cached.state.algorithmVersion,
      refreshedAt: cached.state.refreshedAt,
      checkedAt: cached.state.checkedAt,
      prospectCount: cached.state.prospectCount,
      rowCount: cached.state.rowCount,
    };
  }

  const row = await env.DB.prepare(
    `SELECT source_hash, algorithm_version, refreshed_at, checked_at, prospect_count, row_count
     FROM scouting_refresh_state WHERE singleton = 1`,
  ).first<StateRow>();
  if (!row) return null;
  return {
    sourceHash: row.source_hash,
    algorithmVersion: row.algorithm_version,
    refreshedAt: row.refreshed_at,
    checkedAt: row.checked_at,
    prospectCount: row.prospect_count,
    rowCount: row.row_count,
  };
}

export async function getCurrentScoutingRecords(env: Env): Promise<ScoutingRecord[]> {
  const cached = await getCachedScoutingSnapshot(env);
  if (cached) return cached.records;

  const result = await env.DB.prepare(
    `SELECT sprocket_player_id, mode, league, status, name, salary, games,
       win_pct, score, sprocket, dpi, opi, goals, assists, saves, shots, shot_pct,
       demos, eff_salary, temp, temp_score, bucket, main_role, alt_role,
       role_confidence, flags
     FROM scouting_players_current`,
  ).all<StoredScoutingRow>();
  return result.results.map(fromStored);
}

function weighted(records: ScoutingRecord[], key: keyof Pick<
  ScoutingRecord,
  "winPct" | "score" | "sprocket" | "dpi" | "opi" | "goals" | "assists" | "saves" | "shots" | "demos" | "effSalary" | "temp" | "tempScore"
>): number | null {
  let total = 0;
  let games = 0;
  for (const record of records) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value * record.games;
    games += record.games;
  }
  return games > 0 ? total / games : null;
}

function combineRecords(records: ScoutingRecord[]): ScoutingDisplayRecord[] {
  const groups = new Map<string, ScoutingRecord[]>();
  for (const record of records) {
    const group = groups.get(record.sprocketPlayerId) ?? [];
    group.push(record);
    groups.set(record.sprocketPlayerId, group);
  }

  const combined: ScoutingDisplayRecord[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const games = group.reduce((sum, record) => sum + record.games, 0);
    const goals = weighted(group, "goals");
    const shots = weighted(group, "shots");
    const roleSource = [...group].sort((left, right) => right.games - left.games)[0];
    const buckets = new Set(group.map(record => record.bucket));
    const flags = [...new Set(group.flatMap(record => record.flags ? record.flags.split(" • ") : []))]
      .filter(Boolean)
      .join(" • ");

    combined.push({
      sprocketPlayerId: first.sprocketPlayerId,
      name: first.name,
      salary: first.salary,
      league: first.league,
      status: first.status,
      mode: "combined",
      games,
      winPct: weighted(group, "winPct"),
      score: weighted(group, "score"),
      sprocket: weighted(group, "sprocket"),
      dpi: weighted(group, "dpi"),
      opi: weighted(group, "opi"),
      goals,
      assists: weighted(group, "assists"),
      saves: weighted(group, "saves"),
      shots,
      shotPct: typeof goals === "number" && typeof shots === "number" && shots > 0 ? goals / shots : null,
      demos: weighted(group, "demos"),
      effSalary: weighted(group, "effSalary"),
      temp: weighted(group, "temp") ?? 0,
      tempScore: weighted(group, "tempScore") ?? 0,
      bucket: buckets.size === 1 ? first.bucket : "Warm",
      mainRole: roleSource.mainRole,
      altRole: roleSource.altRole,
      roleConfidence: roleSource.roleConfidence,
      flags,
    });
  }
  return combined;
}

function nullableDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function sortRecords(rows: ScoutingDisplayRecord[], sort: NonNullable<ScoutingFilters["sort"]>): void {
  rows.sort((left, right) => {
    let compared = 0;
    switch (sort) {
      case "gpi": compared = nullableDescending(left.sprocket, right.sprocket); break;
      case "opi": compared = nullableDescending(left.opi, right.opi); break;
      case "dpi": compared = nullableDescending(left.dpi, right.dpi); break;
      case "win_pct": compared = nullableDescending(left.winPct, right.winPct); break;
      case "games": compared = right.games - left.games; break;
      case "salary": compared = nullableDescending(left.salary, right.salary); break;
      case "temp": compared = right.temp - left.temp; break;
      case "efficiency":
      default: compared = nullableDescending(left.effSalary, right.effSalary); break;
    }
    return compared || left.name.localeCompare(right.name);
  });
}

export async function queryScouting(
  env: Env,
  filters: ScoutingFilters,
): Promise<ScoutingListResult> {
  const [stored, state] = await Promise.all([getCurrentScoutingRecords(env), getScoutingState(env)]);
  const base: ScoutingDisplayRecord[] = filters.mode === "combined"
    ? combineRecords(stored)
    : stored.filter(record => !filters.mode || record.mode === filters.mode);

  const search = filters.search?.trim().toLocaleLowerCase("en-US") ?? "";
  const role = filters.role?.trim().toLocaleLowerCase("en-US") ?? "";
  const rows = base.filter(record => {
    if (filters.league && record.league !== filters.league) return false;
    if (filters.bucket && record.bucket !== filters.bucket) return false;
    if (search && !record.name.toLocaleLowerCase("en-US").includes(search)) return false;
    if (role && !record.mainRole.toLocaleLowerCase("en-US").includes(role) && !record.altRole.toLocaleLowerCase("en-US").includes(role)) return false;
    if ((filters.minGames ?? 0) > record.games) return false;
    if (filters.salaryMin !== null && filters.salaryMin !== undefined && (record.salary === null || record.salary < filters.salaryMin)) return false;
    if (filters.salaryMax !== null && filters.salaryMax !== undefined && (record.salary === null || record.salary > filters.salaryMax)) return false;
    if (filters.hideLowSample && record.flags !== "") return false;
    return true;
  });

  sortRecords(rows, filters.sort ?? "efficiency");
  const limit = Math.max(1, Math.min(50, Math.floor(filters.limit ?? 25)));
  return {rows: rows.slice(0, limit), total: rows.length, state};
}

export async function getScoutingPlayer(
  env: Env,
  sprocketPlayerId: string,
  mode: ScoutingViewMode,
): Promise<ScoutingDisplayRecord | null> {
  const stored = (await getCurrentScoutingRecords(env))
    .filter(record => record.sprocketPlayerId === sprocketPlayerId);
  if (stored.length === 0) return null;
  if (mode === "combined") return combineRecords(stored)[0] ?? null;
  return stored.find(record => record.mode === mode) ?? null;
}

export interface PoolPlayer {
  sprocketPlayerId: string;
  name: string;
  salary: number | null;
  league: LeagueCode;
  status: ProspectStatus;
}

export async function getPoolPlayers(
  env: Env,
  league: LeagueCode,
  status: ProspectStatus | null,
  salary: number | null = null,
): Promise<PoolPlayer[]> {
  const cached = await getCachedScoutingSnapshot(env);
  if (cached) {
    return cached.identities
      .filter(player => player.league === league)
      .filter(player => !status || player.status === status)
      .filter(player => salary === null || (player.salary !== null && Math.abs(player.salary - salary) < 0.001))
      .sort((left, right) =>
        left.status.localeCompare(right.status) ||
        (right.salary ?? Number.NEGATIVE_INFINITY) - (left.salary ?? Number.NEGATIVE_INFINITY) ||
        left.name.localeCompare(right.name, "en-US", {sensitivity: "base"}),
      )
      .map(player => ({
        sprocketPlayerId: player.sprocketPlayerId,
        name: player.name,
        salary: player.salary,
        league: player.league,
        status: player.status,
      }));
  }

  const clauses = ["league = ?"];
  const values: unknown[] = [league];

  if (status) {
    clauses.push("status = ?");
    values.push(status);
  }
  if (salary !== null) {
    clauses.push("salary IS NOT NULL AND ABS(salary - ?) < 0.001");
    values.push(salary);
  }

  const result = await env.DB.prepare(
    `SELECT sprocket_player_id, name, salary, league, status
     FROM prospect_pool_current
     WHERE ${clauses.join(" AND ")}
     ORDER BY status ASC, salary DESC, name COLLATE NOCASE ASC`,
  ).bind(...values).all<StoredPoolRow>();

  return result.results.map(row => ({
    sprocketPlayerId: row.sprocket_player_id,
    name: row.name,
    salary: row.salary,
    league: row.league,
    status: row.status,
  }));
}
