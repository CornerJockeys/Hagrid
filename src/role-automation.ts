import type {Env} from "./types";
import {
  DEFAULT_ROLE_AUTOMATION_CONFIG,
  ROLE_AUTOMATION_CIRCUMSTANCES,
  type RoleAutomationCircumstance,
  type RoleAutomationConfig,
} from "./role-automation-policy.ts";

interface RoleAutomationRow {
  circumstance: string;
  role_ids_json: string;
  updated_at: string;
  updated_by_discord_id: string;
}

export interface StoredRoleAutomationConfig {
  mappings: RoleAutomationConfig;
  updatedAt: string | null;
  updatedByDiscordId: string | null;
}

function cloneDefaults(env: Env): RoleAutomationConfig {
  return {
    new_member: /^\d{10,25}$/.test(env.DISCORD_AUTO_ROLE_ID?.trim() ?? "")
      ? [env.DISCORD_AUTO_ROLE_ID!.trim()]
      : [...DEFAULT_ROLE_AUTOMATION_CONFIG.new_member],
    FL: [...DEFAULT_ROLE_AUTOMATION_CONFIG.FL],
    AL: [...DEFAULT_ROLE_AUTOMATION_CONFIG.AL],
    CL: [...DEFAULT_ROLE_AUTOMATION_CONFIG.CL],
    ML: [...DEFAULT_ROLE_AUTOMATION_CONFIG.ML],
    captain: [...DEFAULT_ROLE_AUTOMATION_CONFIG.captain],
  };
}

function isCircumstance(value: string): value is RoleAutomationCircumstance {
  return (ROLE_AUTOMATION_CIRCUMSTANCES as readonly string[]).includes(value);
}

function storedRoleIds(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const roleIds = parsed.filter((item): item is string =>
      typeof item === "string" && /^\d{10,25}$/.test(item),
    );
    return [...new Set(roleIds)];
  } catch {
    return null;
  }
}

export async function getRoleAutomationConfig(
  env: Env,
  guildId: string,
): Promise<StoredRoleAutomationConfig> {
  const result = await env.DB.prepare(
    `SELECT circumstance, role_ids_json, updated_at, updated_by_discord_id
     FROM role_automation_config
     WHERE guild_id = ?`,
  ).bind(guildId).all<RoleAutomationRow>();

  const mappings = cloneDefaults(env);
  let updatedAt: string | null = null;
  let updatedByDiscordId: string | null = null;

  for (const row of result.results) {
    if (!isCircumstance(row.circumstance)) continue;
    const roleIds = storedRoleIds(row.role_ids_json);
    if (roleIds) mappings[row.circumstance] = roleIds;

    if (!updatedAt || row.updated_at > updatedAt) {
      updatedAt = row.updated_at;
      updatedByDiscordId = row.updated_by_discord_id;
    }
  }

  return {mappings, updatedAt, updatedByDiscordId};
}

export async function saveRoleAutomationConfig(
  env: Env,
  guildId: string,
  actorDiscordId: string,
  mappings: RoleAutomationConfig,
): Promise<StoredRoleAutomationConfig> {
  const statements = ROLE_AUTOMATION_CIRCUMSTANCES.map(circumstance =>
    env.DB.prepare(
      `INSERT INTO role_automation_config (
         guild_id, circumstance, role_ids_json, updated_by_discord_id, updated_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id, circumstance) DO UPDATE SET
         role_ids_json = excluded.role_ids_json,
         updated_by_discord_id = excluded.updated_by_discord_id,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      guildId,
      circumstance,
      JSON.stringify(mappings[circumstance]),
      actorDiscordId,
    ),
  );

  const results = await env.DB.batch(statements);
  if (results.some(result => !result.success)) {
    throw new Error("D1 rejected one or more role automation settings.");
  }

  return getRoleAutomationConfig(env, guildId);
}

export async function roleIdsForCircumstance(
  env: Env,
  guildId: string,
  circumstance: RoleAutomationCircumstance,
): Promise<string[]> {
  const config = await getRoleAutomationConfig(env, guildId);
  return config.mappings[circumstance];
}
