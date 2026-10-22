import {roleIdsForCircumstance} from "./role-automation.ts";
import type {Env, ScheduledEventLike} from "./types";

export const DEFAULT_MEMBER_ACCESS_ROLE_ID = "490569480473149453";
const DISCORD_API = "https://discord.com/api/v10";
const MAX_MEMBER_PAGES = 30;
const MAX_ASSIGNMENTS_PER_RUN = 15;

export interface DiscordGuildMember {
  joined_at?: string | null;
  pending?: boolean;
  roles?: string[];
  user?: {
    id?: string;
    username?: string;
    bot?: boolean;
  };
}

interface AutoRoleStateRow {
  last_success_at: string;
}

function configuredGuildId(env: Env): string | null {
  const value = env.DISCORD_GUILD_ID?.trim() ?? "";
  return /^\d{10,25}$/.test(value) ? value : null;
}

function joinedAfter(member: DiscordGuildMember, cutoffIso: string): boolean {
  if (!member.joined_at) return false;
  const joined = Date.parse(member.joined_at);
  const cutoff = Date.parse(cutoffIso);
  return Number.isFinite(joined) && Number.isFinite(cutoff) && joined > cutoff;
}

export function shouldAssignAccessRole(
  member: DiscordGuildMember,
  cutoffIso: string,
  roleId: string,
): boolean {
  return Boolean(
    member.user?.id &&
    !member.user?.bot &&
    !member.pending &&
    joinedAfter(member, cutoffIso) &&
    !(member.roles ?? []).includes(roleId)
  );
}

export function isPendingRecentMember(
  member: DiscordGuildMember,
  cutoffIso: string,
): boolean {
  return Boolean(
    member.user?.id &&
    !member.user?.bot &&
    member.pending &&
    joinedAfter(member, cutoffIso)
  );
}

export async function listGuildMembers(env: Env, guildId: string): Promise<DiscordGuildMember[]> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not configured.");
  }

  const members: DiscordGuildMember[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_MEMBER_PAGES; page += 1) {
    const url = new URL(`${DISCORD_API}/guilds/${guildId}/members`);
    url.searchParams.set("limit", "1000");
    if (after) url.searchParams.set("after", after);

    const response = await fetch(url, {
      headers: {Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`},
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Discord member list failed (${response.status}). Confirm Server Members Intent is enabled. ${body.slice(0, 300)}`,
      );
    }

    const pageMembers = await response.json() as DiscordGuildMember[];
    members.push(...pageMembers);

    if (pageMembers.length < 1000) return members;
    const lastId = pageMembers.at(-1)?.user?.id;
    if (!lastId) {
      throw new Error("Discord member pagination returned a member without a user ID.");
    }
    after = lastId;
  }

  throw new Error(
    `Discord member list exceeded ${MAX_MEMBER_PAGES * 1000} members; automatic role reconciliation stopped safely.`,
  );
}

export async function addMemberRole(
  env: Env,
  guildId: string,
  userId: string,
  roleId: string,
  reason = "Hagrid automatic new-member access role",
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not configured.");
  }

  const response = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "X-Audit-Log-Reason": encodeURIComponent(reason),
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Discord role assignment failed for ${userId} (${response.status}). Confirm Hagrid has Manage Roles and its bot role is above the access role. ${body.slice(0, 300)}`,
    );
  }
}


export async function removeMemberRole(
  env: Env,
  guildId: string,
  userId: string,
  roleId: string,
  reason: string,
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not configured.");
  }

  const response = await fetch(
    DISCORD_API + "/guilds/" + guildId + "/members/" + userId + "/roles/" + roleId,
    {
      method: "DELETE",
      headers: {
        Authorization: "Bot " + env.DISCORD_BOT_TOKEN,
        "X-Audit-Log-Reason": encodeURIComponent(reason),
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(
      "Discord role removal failed for " + userId + " (" + response.status + "). " +
      "Confirm Hagrid has Manage Roles and its bot role is above the managed role. " +
      body.slice(0, 300),
    );
  }
}

async function readState(env: Env, guildId: string): Promise<AutoRoleStateRow | null> {
  return env.DB.prepare(
    "SELECT last_success_at FROM auto_role_state WHERE guild_id = ?",
  ).bind(guildId).first<AutoRoleStateRow>();
}

async function setState(env: Env, guildId: string, cutoffIso: string): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT INTO auto_role_state (guild_id, last_success_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id) DO UPDATE SET
       last_success_at = excluded.last_success_at,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(guildId, cutoffIso).run();

  if (!result.success) {
    throw new Error("Failed to persist automatic role reconciliation state.");
  }
}

export async function runScheduledAutoRole(
  env: Env,
  event: ScheduledEventLike,
): Promise<void> {
  const guildId = configuredGuildId(env);
  if (!guildId || !env.DISCORD_BOT_TOKEN) return;

  const roleIds = await roleIdsForCircumstance(env, guildId, "new_member");
  const scanStartedAt = new Date(event.scheduledTime).toISOString();
  let state = await readState(env, guildId);

  // Start one master-clock interval behind on first deployment so a member who
  // joins between deploy and the first scheduled tick is not lost. Persist the
  // cutoff before calling Discord so permission/intent failures keep the same
  // retry window instead of sliding forward.
  if (!state) {
    const initialCutoff = new Date(event.scheduledTime - 10 * 60 * 1000).toISOString();
    await setState(env, guildId, initialCutoff);
    state = {last_success_at: initialCutoff};
    console.log(`Automatic member role initialized for guild ${guildId} at ${initialCutoff}.`);
  }

  const members = await listGuildMembers(env, guildId);
  const pendingRecent = members.filter(member =>
    isPendingRecentMember(member, state.last_success_at)
  );
  const candidates = members.filter(member =>
    roleIds.some(roleId => shouldAssignAccessRole(member, state.last_success_at, roleId))
  );

  const batch = candidates.slice(0, MAX_ASSIGNMENTS_PER_RUN);
  for (const member of batch) {
    const userId = member.user?.id;
    if (!userId) continue;
    const existingRoles = new Set(member.roles ?? []);
    for (const roleId of roleIds) {
      if (existingRoles.has(roleId)) continue;
      await addMemberRole(env, guildId, userId, roleId);
      existingRoles.add(roleId);
      console.log(
        `Assigned automatic access role ${roleId} to Discord member ${userId} (${member.user?.username ?? "unknown"}).`,
      );
    }
  }

  const hasMoreCandidates = candidates.length > batch.length;

  // Keep the old cutoff if a recent member is still completing Membership
  // Screening, if the batch filled up, or if an assignment throws. That makes
  // the next pass retry unresolved joins without restoring roles to old members.
  if (pendingRecent.length > 0 || hasMoreCandidates) {
    console.log(
      `Automatic member role reconciliation retained its cutoff: ${pendingRecent.length} recent member(s) pending screening, ${Math.max(0, candidates.length - batch.length)} queued assignment(s).`,
    );
    return;
  }

  await setState(env, guildId, scanStartedAt);
}
