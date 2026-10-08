import {
  getGuildConfig,
  setResolvedGuildFranchise,
  type GuildConfig,
} from "./db";
import type {Env} from "./types";

function key(guildId: string): string {
  return `guild:${guildId}:config:v1`;
}

function validConfig(value: unknown): value is GuildConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<GuildConfig>;
  return (
    typeof config.guild_id === "string" &&
    typeof config.franchise_name === "string" &&
    typeof config.updated_by === "string" &&
    typeof config.updated_at === "string"
  );
}

export async function getCachedGuildConfig(
  env: Env,
  guildId: string,
): Promise<GuildConfig | null> {
  if (env.HAGRID_CACHE) {
    try {
      const raw = await env.HAGRID_CACHE.get(key(guildId), "text");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (validConfig(parsed)) return parsed;
      }
    } catch (error) {
      console.error("Failed to read guild config from KV.", error);
    }
  }

  const config = await getGuildConfig(env.DB, guildId);
  if (config && env.HAGRID_CACHE) {
    try {
      await env.HAGRID_CACHE.put(key(guildId), JSON.stringify(config));
    } catch (error) {
      console.error("Failed to populate guild config KV cache.", error);
    }
  }
  return config;
}

export async function setCachedGuildFranchise(
  env: Env,
  guildId: string,
  franchiseName: string,
  franchiseCode: string | null,
  changedBy: string,
): Promise<GuildConfig> {
  const updated = await setResolvedGuildFranchise(
    env.DB,
    guildId,
    franchiseName,
    franchiseCode,
    changedBy,
  );

  if (env.HAGRID_CACHE) {
    try {
      await env.HAGRID_CACHE.put(key(guildId), JSON.stringify(updated));
    } catch (error) {
      console.error("Failed to update guild config KV cache.", error);
    }
  }
  return updated;
}
