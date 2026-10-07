import type {Env, ScheduledEventLike} from "../types";
import {promoteScoutingSnapshotBulk} from "./bulk";
import {getCachedScoutingSnapshot, putCachedScoutingSnapshot} from "./cache";
import {getProspectIdentities, getScoutingStatLines} from "../sprocket/scouting";
import {
  buildScoutingRecords,
  type ProspectIdentity,
  type RawScoutingLine,
  type ScoutingRecord,
} from "./calculate";

export const SCOUTING_ALGORITHM_VERSION = "hcpb-v1.1-2026-09-30";
export const SCOUTING_CRON = "20 * * * *";

interface ScoutingStateRow {
  source_hash: string;
  algorithm_version: string;
  refreshed_at: string;
  checked_at: string;
  prospect_count: number;
  row_count: number;
}

export interface ScoutingRefreshSummary {
  changed: boolean;
  sourceHash: string;
  refreshedAt: string;
  checkedAt: string;
  prospectCount: number;
  rowCount: number;
}

function easternDate(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = new Map(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function normalizeHashInput(
  identities: ProspectIdentity[],
  lines: RawScoutingLine[],
): string {
  return JSON.stringify({
    algorithm: SCOUTING_ALGORITHM_VERSION,
    identities: identities.map(value => [
      value.sprocketPlayerId,
      value.name,
      value.salary,
      value.league,
      value.status,
    ]),
    lines: lines.map(value => [
      value.sprocketPlayerId,
      value.mode,
      value.league,
      value.games,
      value.winPct,
      value.score,
      value.sprocket,
      value.dpi,
      value.opi,
      value.goals,
      value.assists,
      value.saves,
      value.shots,
      value.demos,
    ]),
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function getState(env: Env): Promise<ScoutingStateRow | null> {
  return env.DB
    .prepare(
      `SELECT source_hash, algorithm_version, refreshed_at, checked_at, prospect_count, row_count
       FROM scouting_refresh_state
       WHERE singleton = 1`,
    )
    .first<ScoutingStateRow>();
}

async function getCurrentScoutingRecordsForCache(env: Env): Promise<ScoutingRecord[]> {
  const result = await env.DB.prepare(
    `SELECT sprocket_player_id, mode, league, status, name, salary, games,
       win_pct, score, sprocket, dpi, opi, goals, assists, saves, shots, shot_pct,
       demos, eff_salary, temp, temp_score, bucket, main_role, alt_role,
       role_confidence, flags
     FROM scouting_players_current`,
  ).all<{
    sprocket_player_id: string;
    mode: ScoutingRecord["mode"];
    league: ScoutingRecord["league"];
    status: ScoutingRecord["status"];
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
    bucket: ScoutingRecord["bucket"];
    main_role: ScoutingRecord["mainRole"];
    alt_role: ScoutingRecord["altRole"];
    role_confidence: ScoutingRecord["roleConfidence"];
    flags: string;
  }>();

  return result.results.map(row => ({
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
  }));
}

async function archiveRecordsForDay(
  env: Env,
  date: string,
  records: ScoutingRecord[],
  sourceHash: string,
  refreshedAt: string,
): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO scouting_daily_history (
       snapshot_date, sprocket_player_id, mode, league, status, name, salary, games,
       win_pct, score, sprocket, dpi, opi, goals, assists, saves, shots, shot_pct,
       demos, eff_salary, temp, temp_score, bucket, main_role, alt_role,
       role_confidence, flags, source_hash, refreshed_at
     )
     SELECT
       ?2,
       json_extract(value, '$.sprocketPlayerId'),
       json_extract(value, '$.mode'),
       json_extract(value, '$.league'),
       json_extract(value, '$.status'),
       json_extract(value, '$.name'),
       json_extract(value, '$.salary'),
       COALESCE(json_extract(value, '$.games'), 0),
       json_extract(value, '$.winPct'),
       json_extract(value, '$.score'),
       json_extract(value, '$.sprocket'),
       json_extract(value, '$.dpi'),
       json_extract(value, '$.opi'),
       json_extract(value, '$.goals'),
       json_extract(value, '$.assists'),
       json_extract(value, '$.saves'),
       json_extract(value, '$.shots'),
       json_extract(value, '$.shotPct'),
       json_extract(value, '$.demos'),
       json_extract(value, '$.effSalary'),
       json_extract(value, '$.temp'),
       json_extract(value, '$.tempScore'),
       json_extract(value, '$.bucket'),
       json_extract(value, '$.mainRole'),
       json_extract(value, '$.altRole'),
       json_extract(value, '$.roleConfidence'),
       COALESCE(json_extract(value, '$.flags'), ''),
       ?3,
       ?4
     FROM json_each(?1)`,
  ).bind(JSON.stringify(records), date, sourceHash, refreshedAt).run();
  if (!result.success) throw new Error("D1 rejected the daily scouting archive.");
}

export async function refreshScouting(env: Env, reason = "manual"): Promise<ScoutingRefreshSummary> {
  const checkedAt = new Date().toISOString();
  const [identities, lines] = await Promise.all([
    getProspectIdentities(env),
    getScoutingStatLines(env),
  ]);

  if (identities.length === 0) {
    throw new Error("The Sprocket players dataset did not contain any FA/PEND prospects.");
  }
  if (lines.length === 0) {
    throw new Error("The Sprocket Avg_Scrim_Stats dataset did not contain any usable rows.");
  }

  const sourceHash = await sha256(normalizeHashInput(identities, lines));
  const [cached, state] = await Promise.all([
    getCachedScoutingSnapshot(env),
    getState(env),
  ]);
  const archiveDate = easternDate(new Date(checkedAt));

  if (
    cached &&
    cached.state.sourceHash === sourceHash &&
    cached.state.algorithmVersion === SCOUTING_ALGORITHM_VERSION
  ) {
    let lastArchivedDate = cached.state.lastArchivedDate;
    if (lastArchivedDate !== archiveDate) {
      await archiveRecordsForDay(
        env,
        archiveDate,
        cached.records,
        cached.state.sourceHash,
        cached.state.refreshedAt,
      );
      lastArchivedDate = archiveDate;
    }

    await putCachedScoutingSnapshot(env, {
      ...cached,
      state: {
        ...cached.state,
        checkedAt,
        lastArchivedDate,
      },
    });

    console.log(`Scouting refresh (${reason}) found no source changes; D1 snapshot writes skipped.`);
    return {
      changed: false,
      sourceHash,
      refreshedAt: cached.state.refreshedAt,
      checkedAt,
      prospectCount: cached.state.prospectCount,
      rowCount: cached.state.rowCount,
    };
  }

  if (
    !cached &&
    state &&
    state.source_hash === sourceHash &&
    state.algorithm_version === SCOUTING_ALGORITHM_VERSION
  ) {
    const existingRecords = await getCurrentScoutingRecordsForCache(env);
    await archiveRecordsForDay(
      env,
      archiveDate,
      existingRecords,
      state.source_hash,
      state.refreshed_at,
    );

    await putCachedScoutingSnapshot(env, {
      state: {
        sourceHash,
        algorithmVersion: SCOUTING_ALGORITHM_VERSION,
        refreshedAt: state.refreshed_at,
        checkedAt,
        prospectCount: state.prospect_count,
        rowCount: state.row_count,
        lastArchivedDate: archiveDate,
      },
      identities,
      records: existingRecords,
    });

    console.log(`Scouting refresh (${reason}) found no source changes and primed KV from D1.`);
    return {
      changed: false,
      sourceHash,
      refreshedAt: state.refreshed_at,
      checkedAt,
      prospectCount: state.prospect_count,
      rowCount: state.row_count,
    };
  }

  const records = buildScoutingRecords(identities, lines);
  if (records.length === 0) {
    throw new Error("The scouting calculation produced zero player/mode records.");
  }

  if (env.HAGRID_CACHE) {
    const alreadyArchivedToday = cached?.state.lastArchivedDate === archiveDate;
    if (!alreadyArchivedToday) {
      await archiveRecordsForDay(env, archiveDate, records, sourceHash, checkedAt);
    }

    await putCachedScoutingSnapshot(env, {
      state: {
        sourceHash,
        algorithmVersion: SCOUTING_ALGORITHM_VERSION,
        refreshedAt: checkedAt,
        checkedAt,
        prospectCount: identities.length,
        rowCount: records.length,
        lastArchivedDate: archiveDate,
      },
      identities,
      records,
    });

    console.log(
      `Scouting refresh (${reason}) cached ${records.length} rows for ${identities.length} prospects; current D1 rewrite skipped.`,
    );
  } else {
    await promoteScoutingSnapshotBulk(env, {
      identities,
      records,
      sourceHash,
      algorithmVersion: SCOUTING_ALGORITHM_VERSION,
      now: checkedAt,
    });
    await archiveRecordsForDay(env, archiveDate, records, sourceHash, checkedAt);
    console.log(
      `Scouting refresh (${reason}) promoted ${records.length} rows for ${identities.length} prospects.`,
    );
  }

  return {
    changed: true,
    sourceHash,
    refreshedAt: checkedAt,
    checkedAt,
    prospectCount: identities.length,
    rowCount: records.length,
  };
}

export async function ensureScoutingSnapshot(env: Env): Promise<ScoutingRefreshSummary | null> {
  const cached = await getCachedScoutingSnapshot(env);
  if (cached && cached.state.rowCount > 0) return null;

  const state = await getState(env);
  if (state && state.row_count > 0) return null;
  return refreshScouting(env, "cold-start");
}

export async function runScheduledScoutingRefresh(
  env: Env,
  event: ScheduledEventLike,
): Promise<void> {
  if (event.cron !== SCOUTING_CRON) return;
  try {
    const summary = await refreshScouting(env, "scheduled-hourly");
    console.log(
      summary.changed
        ? `Hourly scouting refresh promoted ${summary.rowCount} rows.`
        : "Hourly scouting refresh completed with no source changes.",
    );
  } catch (error) {
    console.error("Hourly scouting refresh failed.", error);
  }
}
