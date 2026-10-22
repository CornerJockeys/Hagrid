import {
  addMemberRole,
  listGuildMembers,
  removeMemberRole,
  type DiscordGuildMember,
} from "./auto-role";
import {getCachedGuildConfig} from "./config-cache";
import {getCurrentLeagueSnapshot, snapshotTeamPlayers} from "./league/cache";
import {
  getRoleAutomationConfig,
  type StoredRoleAutomationConfig,
} from "./role-automation";
import type {
  RoleAutomationCircumstance,
  RoleAutomationConfig,
} from "./role-automation-policy";
import {rosterRoleTarget, type RosterRoleTarget} from "./roster-role-policy";
import {isRosterRoleReconcileTime} from "./scheduler";
import type {Env, ScheduledEventLike} from "./types";

interface RosterRoleAssignmentRow {
  sprocket_player_id: string;
  discord_user_id: string;
  circumstance: string;
  role_id: string;
}

interface DesiredRole {
  circumstance: RoleAutomationCircumstance;
  roleId: string;
}

function configuredGuildId(env: Env): string | null {
  const value = env.DISCORD_GUILD_ID?.trim() ?? "";
  return /^\d{10,25}$/.test(value) ? value : null;
}

function desiredRoles(
  target: RosterRoleTarget,
  mappings: RoleAutomationConfig,
): DesiredRole[] {
  const roles: DesiredRole[] = [];
  const seen = new Set<string>();

  const add = (
    circumstance: RoleAutomationCircumstance,
    roleIds: readonly string[],
  ): void => {
    for (const roleId of roleIds) {
      if (seen.has(roleId)) continue;
      seen.add(roleId);
      roles.push({circumstance, roleId});
    }
  };

  if (target.division) add(target.division, mappings[target.division]);
  if (target.captain) add("captain", mappings.captain);
  return roles;
}

function configuredRosterRoleIds(
  config: StoredRoleAutomationConfig,
): Set<string> {
  return new Set([
    ...config.mappings.FL,
    ...config.mappings.AL,
    ...config.mappings.CL,
    ...config.mappings.ML,
    ...config.mappings.captain,
  ]);
}

async function getAssignments(
  env: Env,
  guildId: string,
): Promise<RosterRoleAssignmentRow[]> {
  const result = await env.DB.prepare(
    `SELECT sprocket_player_id, discord_user_id, circumstance, role_id
     FROM roster_role_assignments
     WHERE guild_id = ?`,
  ).bind(guildId).all<RosterRoleAssignmentRow>();
  return result.results;
}

async function upsertAssignment(
  env: Env,
  guildId: string,
  target: RosterRoleTarget,
  desired: DesiredRole,
): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT INTO roster_role_assignments (
       guild_id, sprocket_player_id, discord_user_id, circumstance, role_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id, sprocket_player_id, role_id) DO UPDATE SET
       discord_user_id = excluded.discord_user_id,
       circumstance = excluded.circumstance,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    guildId,
    target.sprocketPlayerId,
    target.discordUserId,
    desired.circumstance,
    desired.roleId,
  ).run();

  if (!result.success) throw new Error("Failed to persist roster role assignment.");
}

async function deleteAssignment(
  env: Env,
  guildId: string,
  playerId: string,
  roleId: string,
): Promise<void> {
  const result = await env.DB.prepare(
    `DELETE FROM roster_role_assignments
     WHERE guild_id = ? AND sprocket_player_id = ? AND role_id = ?`,
  ).bind(guildId, playerId, roleId).run();

  if (!result.success) throw new Error("Failed to delete stale roster role assignment.");
}

function roleSet(member: DiscordGuildMember | undefined): Set<string> {
  return new Set(member?.roles ?? []);
}

async function removeRoleIfPresent(
  env: Env,
  guildId: string,
  discordUserId: string,
  roleId: string,
  member: DiscordGuildMember | undefined,
  reason: string,
): Promise<void> {
  if (!member?.user?.id || !(member.roles ?? []).includes(roleId)) return;
  await removeMemberRole(env, guildId, discordUserId, roleId, reason);
}

export async function reconcileRosterRoles(env: Env): Promise<{
  franchise: string;
  targets: number;
  managedRoles: number;
  cleanedRoles: number;
}> {
  const guildId = configuredGuildId(env);
  if (!guildId || !env.DISCORD_BOT_TOKEN) {
    return {franchise: "", targets: 0, managedRoles: 0, cleanedRoles: 0};
  }

  const [config, snapshot, members, assignments, automation] = await Promise.all([
    getCachedGuildConfig(env, guildId),
    getCurrentLeagueSnapshot(env),
    listGuildMembers(env, guildId),
    getAssignments(env, guildId),
    getRoleAutomationConfig(env, guildId),
  ]);

  if (!config || !snapshot) {
    return {
      franchise: config?.franchise_name ?? "",
      targets: 0,
      managedRoles: 0,
      cleanedRoles: 0,
    };
  }

  const memberById = new Map(
    members
      .filter(member => Boolean(member.user?.id))
      .map(member => [member.user!.id!, member]),
  );

  const targets = snapshotTeamPlayers(snapshot, config.franchise_name)
    .map(rosterRoleTarget)
    .filter((target): target is RosterRoleTarget => target !== null);
  const targetByPlayer = new Map(targets.map(target => [target.sprocketPlayerId, target]));
  const managedRosterRoles = configuredRosterRoleIds(automation);
  const baselineRoles = new Set(automation.mappings.new_member);

  let cleanedRoles = 0;

  // Remove roles that Hagrid had adopted previously when a player is released,
  // transferred, relinked, promoted/demoted, or when GM/FM changes a mapping.
  for (const assignment of assignments) {
    const target = targetByPlayer.get(assignment.sprocket_player_id);
    const desired = target
      ? new Set(desiredRoles(target, automation.mappings).map(value => value.roleId))
      : new Set<string>();
    const stillDesired =
      target &&
      target.discordUserId === assignment.discord_user_id &&
      desired.has(assignment.role_id);

    if (stillDesired) continue;

    if (!baselineRoles.has(assignment.role_id)) {
      await removeRoleIfPresent(
        env,
        guildId,
        assignment.discord_user_id,
        assignment.role_id,
        memberById.get(assignment.discord_user_id),
        "Hagrid roster role cleanup",
      );
    }
    await deleteAssignment(
      env,
      guildId,
      assignment.sprocket_player_id,
      assignment.role_id,
    );
    cleanedRoles += 1;
  }

  let managedRoles = 0;

  for (const target of targets) {
    const member = memberById.get(target.discordUserId);
    if (!member?.user?.id || member.pending) continue;

    const roles = roleSet(member);
    const desired = desiredRoles(target, automation.mappings);
    const desiredIds = new Set(desired.map(value => value.roleId));

    // Once a role ID is configured in this Admin panel it is part of Hagrid's
    // roster-role domain. Remove stale configured roles even if an older bot or
    // a human originally assigned them, which makes first-run promotions and
    // demotions self-healing.
    for (const roleId of managedRosterRoles) {
      if (baselineRoles.has(roleId) || desiredIds.has(roleId) || !roles.has(roleId)) continue;
      await removeMemberRole(
        env,
        guildId,
        target.discordUserId,
        roleId,
        "Hagrid roster role redistribution",
      );
      roles.delete(roleId);
      cleanedRoles += 1;
    }

    for (const role of desired) {
      if (!roles.has(role.roleId)) {
        await addMemberRole(
          env,
          guildId,
          target.discordUserId,
          role.roleId,
          "Hagrid roster role reconciliation",
        );
        roles.add(role.roleId);
      }

      await upsertAssignment(env, guildId, target, role);
      managedRoles += 1;
    }
  }

  console.log(
    `Roster role reconciliation for ${config.franchise_name}: ` +
    `${managedRoles} managed role assignment(s), ${cleanedRoles} cleanup(s).`,
  );

  return {
    franchise: config.franchise_name,
    targets: targets.length,
    managedRoles,
    cleanedRoles,
  };
}

export async function runScheduledRosterRoleReconciliation(
  env: Env,
  event: ScheduledEventLike,
): Promise<void> {
  if (!isRosterRoleReconcileTime(event.scheduledTime)) return;
  try {
    await reconcileRosterRoles(env);
  } catch (error) {
    console.error("Hourly roster role reconciliation failed.", error);
  }
}
