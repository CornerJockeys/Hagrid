import type {D1Database, D1PreparedStatement} from "../types";

export type SyncTrigger = "manual" | "scheduled";
export type SyncStatus = "RUNNING" | "SUCCESS" | "FAILED";

export interface SyncRun {
  run_id: string;
  guild_id: string;
  trigger_type: SyncTrigger;
  triggered_by: string | null;
  status: SyncStatus;
  franchise_name: string;
  franchise_code: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  player_count: number | null;
  usage_count: number | null;
  change_count: number | null;
}

export interface CurrentPlayerRow {
  guild_id: string;
  sprocket_player_id: string;
  member_id: string | null;
  discord_id: string | null;
  name: string;
  salary: number | null;
  skill_group: string | null;
  game_id: string | null;
  game_title: string | null;
  franchise_name: string;
  staff_position: string | null;
  slot: string | null;
  current_scrim_points: number;
  eligible_through: string | null;
  source_as_of: string | null;
  last_sync_run_id: string;
}

export async function createSyncRun(
  db: D1Database,
  runId: string,
  guildId: string,
  trigger: SyncTrigger,
  triggeredBy: string | null,
  franchiseName: string,
  franchiseCode: string | null,
): Promise<void> {
  const result = await db
    .prepare(
      `INSERT INTO sync_runs (
         run_id,
         guild_id,
         trigger_type,
         triggered_by,
         status,
         franchise_name,
         franchise_code
       ) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?)`,
    )
    .bind(runId, guildId, trigger, triggeredBy, franchiseName, franchiseCode)
    .run();

  if (!result.success) {
    throw new Error("Failed to create sync run.");
  }
}

export async function markSyncRunFailed(
  db: D1Database,
  runId: string,
  message: string,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE sync_runs
       SET status = 'FAILED',
           completed_at = CURRENT_TIMESTAMP,
           error_message = ?
       WHERE run_id = ?`,
    )
    .bind(message.slice(0, 2000), runId)
    .run();

  if (!result.success) {
    console.error(`Failed to mark sync run ${runId} as failed.`);
  }
}

export async function getLatestSyncRun(
  db: D1Database,
  guildId: string,
): Promise<SyncRun | null> {
  return db
    .prepare(
      `SELECT run_id, guild_id, trigger_type, triggered_by, status, franchise_name, franchise_code,
              started_at, completed_at, error_message, player_count, usage_count, change_count
       FROM sync_runs
       WHERE guild_id = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .bind(guildId)
    .first<SyncRun>();
}

export async function getCurrentPlayers(
  db: D1Database,
  guildId: string,
): Promise<CurrentPlayerRow[]> {
  const result = await db
    .prepare(
      `SELECT guild_id, sprocket_player_id, member_id, discord_id, name, salary, skill_group,
              game_id, game_title, franchise_name, staff_position, slot, current_scrim_points,
              eligible_through, source_as_of, last_sync_run_id
       FROM franchise_players_current
       WHERE guild_id = ?`,
    )
    .bind(guildId)
    .all<CurrentPlayerRow>();

  if (!result.success) {
    throw new Error("Failed to read current franchise players.");
  }

  return result.results;
}

export function completeSyncStatement(
  db: D1Database,
  runId: string,
  playerCount: number,
  usageCount: number,
  changeCount: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sync_runs
       SET status = 'SUCCESS',
           completed_at = CURRENT_TIMESTAMP,
           error_message = NULL,
           player_count = ?,
           usage_count = ?,
           change_count = ?
       WHERE run_id = ?`,
    )
    .bind(playerCount, usageCount, changeCount, runId);
}
