import {getCachedGuildConfig} from "./config-cache";
import {DIVISION_ROLE_IDS, STAFF_ROLE_IDS} from "./discord-roles";
import {rosterRoleTarget, type RosterRoleTarget} from "./roster-role-policy";
import {
  addMemberRole,
  listGuildMembers,
  removeMemberRole,
  type DiscordGuildMember,
} from "./auto-role";
import {getCurrentLeagueSnapshot, snapshotTeamPlayers} from "./league/cache";
import {isCompetitiveSlot, teamDivision} from "./league/view";
import {isRosterRoleReconcileTime} from "./scheduler";
import type {Env, ScheduledEventLike} from "./types";

interface RosterRoleStateRow {
  sprocket_player_id: string;
  discord_user_id: string;
  division_role_id: string | null;
  captain_managed: number;
}

async function getRoleState(env: Env, guildId: string): Promise<RosterRoleStateRow[]> {
  const result = await env.DB.prepare(
    "SELECT sprocket_player_id, discord_user_id, division_role_id, captain_managed " +
    "FROM roster_role_state WHERE guild_id = ?",
  ).bind(guildId).all<RosterRoleStateRow>();
  return result.results;
}

async function upsertRoleState(
  env: Env,
  guildId: string,
  target: RosterRoleTarget,
): Promise<void> {
  const result = await env.DB.prepare(
    "INSERT INTO roster_role_state (" +
      "guild_id, sprocket_player_id, discord_user_id, division_role_id, captain_managed, updated_at" +
    ") VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) " +
    "ON CONFLICT(guild_id, sprocket_player_id) DO UPDATE SET " +
      "discord_user_id = excluded.discord_user_id, " +
      "division_role_id = excluded.division_role_id, " +
      "captain_managed = excluded.captain_managed, " +
      "updated_at = CURRENT_TIMESTAMP",
  ).bind(
    guildId,
    target.sprocketPlayerId,
    target.discordUserId,
    target.divisionRoleId,
    target.captain ? 1 : 0,
  ).run();

  if (!result.success) throw new Error("Failed to persist roster role state.");
}

async function deleteRoleState(
  env: Env,
  guildId: string,
  sprocketPlayerId: string,
): Promise<void> {
  const result = await env.DB.prepare(
    "DELETE FROM roster_role_state WHERE guild_id = ? AND sprocket_player_id = ?",
  ).bind(guildId, sprocketPlayerId).run();

  if (!result.success) throw new Error("Failed to remove stale roster role state.");
}

function roleSet(member: DiscordGuildMember | undefined): Set<string> {
  return new Set(member?.roles ?? []);
}

async function cleanupManagedRoles(
  env: Env,
  guildId: string,
  state: RosterRoleStateRow,
  member: DiscordGuildMember | undefined,
): Promise<void> {
  if (!member?.user?.id) return;
  const roles = roleSet(member);

  if (state.division_role_id && roles.has(state.division_role_id)) {
    await removeMemberRole(
      env,
      guildId,
      state.discord_user_id,
      state.division_role_id,
      "Hagrid roster transaction cleanup",
    );
  }

  if (state.captain_managed === 1 && roles.has(STAFF_ROLE_IDS.RL_CAPTAIN)) {
    await removeMemberRole(
      env,
      guildId,
      state.discord_user_id,
      STAFF_ROLE_IDS.RL_CAPTAIN,
      "Hagrid roster transaction cleanup",
    );
  }
}

async function reconcileCurrentTarget(
  env: Env,
  guildId: string,
  target: RosterRoleTarget,
  previous: RosterRoleStateRow | undefined,
  member: DiscordGuildMember | undefined,
): Promise<void> {
  // Record the desired state even if the player has not joined the server yet.
  if (!member?.user?.id || member.pending) {
    await upsertRoleState(env, guildId, target);
    return;
  }

  const roles = roleSet(member);

  if (target.divisionRoleId) {
    // Competitive players should have exactly one managed division role. This
    // corrects promotions/demotions even on Hagrid's first reconciliation.
    for (const divisionRoleId of Object.values(DIVISION_ROLE_IDS)) {
      if (divisionRoleId === target.divisionRoleId || !roles.has(divisionRoleId)) continue;
      await removeMemberRole(
        env,
        guildId,
        target.discordUserId,
        divisionRoleId,
        "Hagrid roster division reconciliation",
      );
      roles.delete(divisionRoleId);
    }

    if (!roles.has(target.divisionRoleId)) {
      await addMemberRole(
        env,
        guildId,
        target.discordUserId,
        target.divisionRoleId,
        "Hagrid roster division reconciliation",
      );
      roles.add(target.divisionRoleId);
    }
  } else if (
    previous?.division_role_id &&
    roles.has(previous.division_role_id)
  ) {
    // A player who becomes non-playing staff loses only the division role that
    // Hagrid had previously managed. Existing manual staff roles are untouched.
    await removeMemberRole(
      env,
      guildId,
      target.discordUserId,
      previous.division_role_id,
      "Hagrid roster division reconciliation",
    );
  }

  if (target.captain) {
    if (!roles.has(STAFF_ROLE_IDS.RL_CAPTAIN)) {
      await addMemberRole(
        env,
        guildId,
        target.discordUserId,
        STAFF_ROLE_IDS.RL_CAPTAIN,
        "Hagrid roster Captain reconciliation",
      );
    }
  } else if (
    previous?.captain_managed === 1 &&
    roles.has(STAFF_ROLE_IDS.RL_CAPTAIN)
  ) {
    await removeMemberRole(
      env,
      guildId,
      target.discordUserId,
      STAFF_ROLE_IDS.RL_CAPTAIN,
      "Hagrid roster Captain reconciliation",
    );
  }

  if (!target.divisionRoleId && !target.captain) {
    if (previous) await deleteRoleState(env, guildId, target.sprocketPlayerId);
    return;
  }

  await upsertRoleState(env, guildId, target);
}

export async function reconcileRosterRoles(env: Env): Promise<{
  franchise: string;
  targets: number;
  managed: number;
  cleaned: number;
}> {
  const guildId = configuredGuildId(env);
  if (!guildId || !env.DISCORD_BOT_TOKEN) {
    return {franchise: "", targets: 0, managed: 0, cleaned: 0};
  }

  const [config, snapshot, members, states] = await Promise.all([
    getCachedGuildConfig(env, guildId),
    getCurrentLeagueSnapshot(env),
    listGuildMembers(env, guildId),
    getRoleState(env, guildId),
  ]);

  if (!config || !snapshot) {
    return {
      franchise: config?.franchise_name ?? "",
      targets: 0,
      managed: 0,
      cleaned: 0,
    };
  }

  const memberById = new Map(
    members
      .filter(member => Boolean(member.user?.id))
      .map(member => [member.user!.id!, member]),
  );
  const stateByPlayer = new Map(states.map(state => [state.sprocket_player_id, state]));

  const targets = snapshotTeamPlayers(snapshot, config.franchise_name)
    .map(rosterRoleTarget)
    .filter((target): target is RosterRoleTarget => target !== null);
  const targetByPlayer = new Map(targets.map(target => [target.sprocketPlayerId, target]));

  let cleaned = 0;

  // Releases, transfers, and Discord-account relinks only remove roles Hagrid
  // previously recorded as managed. AGM/GM/FM are never part of this state.
  for (const state of states) {
    const current = targetByPlayer.get(state.sprocket_player_id);
    if (current && current.discordUserId === state.discord_user_id) continue;

    await cleanupManagedRoles(
      env,
      guildId,
      state,
      memberById.get(state.discord_user_id),
    );
    await deleteRoleState(env, guildId, state.sprocket_player_id);
    stateByPlayer.delete(state.sprocket_player_id);
    cleaned += 1;
  }

  let managed = 0;
  for (const target of targets) {
    await reconcileCurrentTarget(
      env,
      guildId,
      target,
      stateByPlayer.get(target.sprocketPlayerId),
      memberById.get(target.discordUserId),
    );
    if (target.divisionRoleId || target.captain) managed += 1;
  }

  console.log(
    "Roster role reconciliation for " + config.franchise_name + ": " +
    managed + " managed player(s), " + cleaned + " stale assignment(s) cleaned.",
  );

  return {
    franchise: config.franchise_name,
    targets: targets.length,
    managed,
    cleaned,
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
