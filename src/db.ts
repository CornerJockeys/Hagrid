import type {D1Database} from "./types";

export interface GuildConfig {
  guild_id: string;
  franchise_name: string;
  franchise_code: string | null;
  updated_by: string;
  updated_at: string;
}

export async function getGuildConfig(db: D1Database, guildId: string): Promise<GuildConfig | null> {
  return db
    .prepare(
      `SELECT guild_id, franchise_name, franchise_code, updated_by, updated_at
       FROM guild_config
       WHERE guild_id = ?`,
    )
    .bind(guildId)
    .first<GuildConfig>();
}

export async function getConfiguredGuilds(db: D1Database): Promise<GuildConfig[]> {
  const result = await db
    .prepare(
      `SELECT guild_id, franchise_name, franchise_code, updated_by, updated_at
       FROM guild_config
       ORDER BY guild_id`,
    )
    .all<GuildConfig>();

  if (!result.success) {
    throw new Error("Failed to read configured Discord servers.");
  }

  return result.results;
}

async function saveGuildFranchise(
  db: D1Database,
  guildId: string,
  franchiseName: string,
  franchiseCode: string | null,
  changedBy: string,
): Promise<GuildConfig> {
  const previous = await getGuildConfig(db, guildId);

  const upsert = await db
    .prepare(
      `INSERT INTO guild_config (
         guild_id,
         franchise_name,
         franchise_code,
         updated_by,
         updated_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET
         franchise_name = excluded.franchise_name,
         franchise_code = excluded.franchise_code,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(guildId, franchiseName, franchiseCode, changedBy)
    .run();

  if (!upsert.success) {
    throw new Error("Failed to update franchise configuration.");
  }

  const history = await db
    .prepare(
      `INSERT INTO guild_config_history (
         guild_id,
         previous_franchise_name,
         new_franchise_name,
         changed_by
       ) VALUES (?, ?, ?, ?)`,
    )
    .bind(guildId, previous?.franchise_name ?? null, franchiseName, changedBy)
    .run();

  if (!history.success) {
    throw new Error("Franchise configuration changed, but the audit entry failed.");
  }

  const updated = await getGuildConfig(db, guildId);
  if (!updated) {
    throw new Error("Franchise configuration could not be read after update.");
  }

  return updated;
}

export function setGuildFranchise(
  db: D1Database,
  guildId: string,
  franchiseName: string,
  changedBy: string,
): Promise<GuildConfig> {
  return saveGuildFranchise(db, guildId, franchiseName, null, changedBy);
}

export function setResolvedGuildFranchise(
  db: D1Database,
  guildId: string,
  franchiseName: string,
  franchiseCode: string | null,
  changedBy: string,
): Promise<GuildConfig> {
  return saveGuildFranchise(db, guildId, franchiseName, franchiseCode, changedBy);
}
