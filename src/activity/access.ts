import {getCachedGuildConfig} from "../config-cache";
import {getCurrentLeagueSnapshot} from "../league/cache";
import type {Env} from "../types";
import type {ActivityPrincipal} from "./auth";

const ACTIVITY_STAFF_ROLE_IDS = {
  FM: "468262078730469386",
  GM: "857328892351610930",
  AGM: "468185329141153792",
  RL_CAPTAIN: "727696641502478338",
} as const;

const ACTIVITY_DIVISION_ROLE_IDS = {
  FL: "1074149871466053722",
  AL: "468184958222204940",
  CL: "468185085087318017",
  ML: "548359826258788353",
} as const;

function hasActivityStaffRole(roleIds: readonly string[]): boolean {
  const roles = new Set(roleIds);
  return Object.values(ACTIVITY_STAFF_ROLE_IDS).some(roleId => roles.has(roleId));
}

function activityCaptainDivisions(roleIds: readonly string[]): Array<"FL" | "AL" | "CL" | "ML"> {
  const roles = new Set(roleIds);
  if (!roles.has(ACTIVITY_STAFF_ROLE_IDS.RL_CAPTAIN)) return [];
  return (Object.entries(ACTIVITY_DIVISION_ROLE_IDS) as Array<["FL" | "AL" | "CL" | "ML", string]>)
    .filter(([, roleId]) => roles.has(roleId))
    .map(([division]) => division);
}

import {
  accessFromRosterRows,
  type AccessRow,
  type ActivityAccess,
} from "./access-core";

export {
  accessFromRosterRow,
  accessFromRosterRows,
} from "./access-core";
export type {ActivityAccess} from "./access-core";

function discordStaffLabel(roleIds: readonly string[]): string | null {
  const roles = new Set(roleIds);
  if (roles.has(ACTIVITY_STAFF_ROLE_IDS.FM)) return "FM";
  if (roles.has(ACTIVITY_STAFF_ROLE_IDS.GM)) return "GM";
  if (roles.has(ACTIVITY_STAFF_ROLE_IDS.AGM)) return "AGM";
  if (roles.has(ACTIVITY_STAFF_ROLE_IDS.RL_CAPTAIN)) return "Captain";
  return null;
}

export async function getActivityAccess(
  env: Env,
  auth: ActivityPrincipal,
): Promise<ActivityAccess> {
  let rows: AccessRow[] = [];
  const [config, snapshot] = await Promise.all([
    getCachedGuildConfig(env, auth.guildId),
    getCurrentLeagueSnapshot(env),
  ]);

  if (config && snapshot) {
    const franchise = config.franchise_name.trim().toLocaleLowerCase("en-US");
    rows = snapshot.players
      .filter(player =>
        player.discord_id === auth.userId &&
        player.franchise_name.trim().toLocaleLowerCase("en-US") === franchise,
      )
      .map(player => ({
        sprocket_player_id: player.sprocket_player_id,
        name: player.name,
        skill_group: player.skill_group,
        staff_position: player.staff_position,
        slot: player.slot,
      }));
  } else {
    const result = await env.DB.prepare(
      `SELECT sprocket_player_id, name, skill_group, staff_position, slot
       FROM franchise_players_current
       WHERE guild_id = ?1 AND discord_id = ?2
       UNION ALL
       SELECT player.sprocket_player_id, player.name, player.skill_group,
              player.staff_position, player.slot
       FROM league_players_current player
       INNER JOIN guild_config config
         ON LOWER(config.franchise_name) = LOWER(player.franchise_name)
       WHERE config.guild_id = ?1 AND player.discord_id = ?2`,
    ).bind(auth.guildId, auth.userId).all<AccessRow>();
    rows = result.results;
  }

  const cached = accessFromRosterRows(rows);
  const discordStaff = hasActivityStaffRole(auth.roleIds);
  const captainDivisions = activityCaptainDivisions(auth.roleIds);
  const discordDivision = captainDivisions.length === 1 ? captainDivisions[0] : null;

  // Discord roles are authoritative for staff/captain permissions. Cached
  // league identity is only used to resolve player/slot/division context.
  return {
    ...cached,
    staff: discordStaff,
    captainPlus: discordStaff,
    division: cached.division ?? discordDivision,
    staffPosition: discordStaffLabel(auth.roleIds),
  };
}

export async function requireRosterAccess(
  env: Env,
  auth: ActivityPrincipal,
): Promise<ActivityAccess | Response> {
  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember) {
    return Response.json(
      {error: "Your Discord account is not linked to the current franchise roster in Hagrid."},
      {status: 403},
    );
  }
  return access;
}

export async function requireCaptainPlusAccess(
  env: Env,
  auth: ActivityPrincipal,
): Promise<ActivityAccess | Response> {
  const access = await getActivityAccess(env, auth);
  if (!access.captainPlus) {
    return Response.json(
      {error: "This Activity view is limited to current franchise Captain/AGM/GM/FM staff."},
      {status: 403},
    );
  }
  return access;
}

export async function requireStaffAccess(
  env: Env,
  auth: ActivityPrincipal,
): Promise<ActivityAccess | Response> {
  const access = await getActivityAccess(env, auth);
  if (!access.staff) {
    return Response.json(
      {error: "This Activity view is limited to current franchise staff and captains."},
      {status: 403},
    );
  }
  return access;
}

export function isAccessResponse(value: ActivityAccess | Response): value is Response {
  return value instanceof Response;
}
