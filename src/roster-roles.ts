import {
  addMemberRole,
  listGuildMembers,
  removeMemberRole,
  type DiscordGuildMember,
} from "./auto-role";
import {getCachedGuildConfig} from "./config-cache";
import {getCurrentLeagueSnapshot, snapshotTeamPlayers} from "./league/cache";
import {isCompetitiveSlot} from "./league/view";
import {
  getRoleAutomationConfig,
  type StoredRoleAutomationConfig,
} from "./role-automation";
import type {
  RoleAutomationCircumstance,
  RoleAutomationConfig,
} from "./role-automation-policy";
import {
  formerRoleFlags,
  isFranchiseStaffPosition,
  rosterRoleTarget,
  type RosterRoleTarget,
} from "./roster-role-policy";
import {isRosterRoleReconcileTime} from "./scheduler";
import type {Env, ScheduledEventLike} from "./types";

interface RosterRoleAssignmentRow {
  sprocket_player_id: string;
  discord_user_id: string;
  circumstance: string;
  role_id: string;
}

interface FranchiseHistoryRow {
  sprocket_player_id: string;
  discord_id: string | null;
  slot: string | null;
  staff_position: string | null;
  valid_from: string;
}

interface HistoricalProfile {
  sprocketPlayerId: string;
  discordUserId: string | null;
  wasPlayer: boolean;
  wasFranchiseStaff: boolean;
}

interface ReconciliationTarget extends RosterRoleTarget {
  formerPlayer: boolean;
  formerFranchiseStaff: boolean;
}

interface DesiredRole {
  circumstance: RoleAutomationCircumstance;
  roleId: string;
}

function configuredGuildId(env: Env): string | null {
  const value = env.DISCORD_GUILD_ID?.trim() ?? "";
  return /^\d{10,25}$/.test(value) ? value : null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function usableDiscordId(value: string | null | undefined): string | null {
  const discordId = value?.trim() ?? "";
  return /^\d{10,25}$/.test(discordId) ? discordId : null;
}

function desiredRoles(
  target: ReconciliationTarget,
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
  if (target.formerPlayer) add("former_player", mappings.former_player);
  if (target.formerFranchiseStaff) {
    add("former_franchise_staff", mappings.former_franchise_staff);
  }
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
    ...config.mappings.former_player,
    ...config.mappings.former_franchise_staff,
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

async function getFranchiseHistory(
  env: Env,
  franchiseName: string,
): Promise<HistoricalProfile[]> {
  const result = await env.DB.prepare(
    `SELECT sprocket_player_id, discord_id, slot, staff_position, valid_from
     FROM league_player_history
     WHERE LOWER(franchise_name) = LOWER(?)
     ORDER BY sprocket_player_id, valid_from DESC`,
  ).bind(franchiseName).all<FranchiseHistoryRow>();

  const profiles = new Map<string, HistoricalProfile>();

  for (const row of result.results) {
    let profile = profiles.get(row.sprocket_player_id);
    if (!profile) {
      profile = {
        sprocketPlayerId: row.sprocket_player_id,
        discordUserId: usableDiscordId(row.discord_id),
        wasPlayer: false,
        wasFranchiseStaff: false,
      };
      profiles.set(row.sprocket_player_id, profile);
    } else if (!profile.discordUserId) {
      profile.discordUserId = usableDiscordId(row.discord_id);
    }

    profile.wasPlayer ||= isCompetitiveSlot(row.slot);
    profile.wasFranchiseStaff ||= isFranchiseStaffPosition(row.staff_position);
  }

  return [...profiles.values()];
}

async function upsertAssignment(
  env: Env,
  guildId: string,
  target: ReconciliationTarget,
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

function reconciliationTargets(input: {
  franchiseName: string;
  snapshotPlayers: Array<{
    sprocket_player_id: string;
    discord_id: string | null;
    franchise_name: string;
    skill_group: string | null;
    staff_position: string | null;
    slot: string | null;
  }>;
  currentFranchisePlayers: Array<{
    sprocket_player_id: string;
    discord_id: string | null;
    skill_group: string | null;
    staff_position: string | null;
    slot: string | null;
  }>;
  history: HistoricalProfile[];
}): ReconciliationTarget[] {
  const targetMap = new Map<string, ReconciliationTarget>();
  const currentByPlayer = new Map(
    input.snapshotPlayers.map(player => [player.sprocket_player_id, player]),
  );
  const historyByPlayer = new Map(
    input.history.map(profile => [profile.sprocketPlayerId, profile]),
  );

  for (const player of input.currentFranchisePlayers) {
    const target = rosterRoleTarget(player);
    if (!target) continue;
    const history = historyByPlayer.get(target.sprocketPlayerId);
    const current = currentByPlayer.get(target.sprocketPlayerId);
    const currentSameFranchise =
      Boolean(current) &&
      normalize(current?.franchise_name) === normalize(input.franchiseName);
    const flags = formerRoleFlags({
      wasPlayer: history?.wasPlayer ?? false,
      wasFranchiseStaff: history?.wasFranchiseStaff ?? false,
      currentKnown: Boolean(current),
      currentSameFranchise,
      currentCompetitive: Boolean(current && isCompetitiveSlot(current.slot)),
      currentFranchiseStaff: Boolean(
        current && isFranchiseStaffPosition(current.staff_position)
      ),
    });

    targetMap.set(target.sprocketPlayerId, {
      ...target,
      ...flags,
    });
  }

  for (const history of input.history) {
    const current = currentByPlayer.get(history.sprocketPlayerId);
    const currentSameFranchise =
      Boolean(current) &&
      normalize(current?.franchise_name) === normalize(input.franchiseName);
    const flags = formerRoleFlags({
      wasPlayer: history.wasPlayer,
      wasFranchiseStaff: history.wasFranchiseStaff,
      currentKnown: Boolean(current),
      currentSameFranchise,
      currentCompetitive: Boolean(current && isCompetitiveSlot(current.slot)),
      currentFranchiseStaff: Boolean(
        current && isFranchiseStaffPosition(current.staff_position)
      ),
    });

    if (!flags.formerPlayer && !flags.formerFranchiseStaff) continue;

    const existing = targetMap.get(history.sprocketPlayerId);
    if (existing) {
      existing.formerPlayer = flags.formerPlayer;
      existing.formerFranchiseStaff = flags.formerFranchiseStaff;
      continue;
    }

    // If Sprocket still has a current row, trust its Discord link. When the row
    // is absent, fall back to the most recent linked Discord ID in franchise history.
    const discordUserId = current
      ? usableDiscordId(current.discord_id)
      : history.discordUserId;
    if (!discordUserId) continue;

    targetMap.set(history.sprocketPlayerId, {
      sprocketPlayerId: history.sprocketPlayerId,
      discordUserId,
      division: null,
      captain: false,
      formerPlayer: flags.formerPlayer,
      formerFranchiseStaff: flags.formerFranchiseStaff,
    });
  }

  return [...targetMap.values()];
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

  const config = await getCachedGuildConfig(env, guildId);
  const snapshot = await getCurrentLeagueSnapshot(env);
  if (!config || !snapshot) {
    return {
      franchise: config?.franchise_name ?? "",
      targets: 0,
      managedRoles: 0,
      cleanedRoles: 0,
    };
  }

  const [members, assignments, automation, history] = await Promise.all([
    listGuildMembers(env, guildId),
    getAssignments(env, guildId),
    getRoleAutomationConfig(env, guildId),
    getFranchiseHistory(env, config.franchise_name),
  ]);

  const memberById = new Map(
    members
      .filter(member => Boolean(member.user?.id))
      .map(member => [member.user!.id!, member]),
  );

  const targets = reconciliationTargets({
    franchiseName: config.franchise_name,
    snapshotPlayers: snapshot.players,
    currentFranchisePlayers: snapshotTeamPlayers(snapshot, config.franchise_name),
    history,
  });
  const targetByPlayer = new Map(targets.map(target => [target.sprocketPlayerId, target]));
  const managedRosterRoles = configuredRosterRoleIds(automation);
  const baselineRoles = new Set(automation.mappings.new_member);

  let cleanedRoles = 0;

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
