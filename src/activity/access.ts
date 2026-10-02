import {getGuildConfig} from "../db";
import {getFranchisePlayers} from "../sprocket/players";
import type {Env} from "../types";
import type {ActivityPrincipal} from "./auth";

interface AccessRow {
  sprocket_player_id: string;
  name: string;
  skill_group: string | null;
  staff_position: string | null;
  slot: string | null;
}

export interface ActivityAccess {
  rosterMember: boolean;
  staff: boolean;
  playerId: string | null;
  playerName: string | null;
  division: string | null;
  staffPosition: string | null;
  slot: string | null;
}

function textSuggestsStaffRole(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return (
    /(^|\b)(captain|capt)(\b|$)/.test(normalized) ||
    normalized === "agm" ||
    normalized === "gm" ||
    normalized.includes("assistant general manager") ||
    normalized.includes("general manager")
  );
}

export function accessFromRosterRows(rows: AccessRow[]): ActivityAccess {
  if (rows.length === 0) {
    return {
      rosterMember: false,
      staff: false,
      playerId: null,
      playerName: null,
      division: null,
      staffPosition: null,
      slot: null,
    };
  }

  const preferred =
    rows.find(row => Boolean(row.staff_position?.trim())) ??
    rows.find(row => textSuggestsStaffRole(row.slot)) ??
    rows[0];
  const staffPosition = preferred.staff_position?.trim() || null;

  return {
    rosterMember: true,
    staff: rows.some(row =>
      Boolean(row.staff_position?.trim()) || textSuggestsStaffRole(row.slot),
    ),
    playerId: preferred.sprocket_player_id,
    playerName: preferred.name,
    division: preferred.skill_group?.trim() || null,
    staffPosition,
    slot: preferred.slot?.trim() || null,
  };
}

export function accessFromRosterRow(row: AccessRow | null): ActivityAccess {
  return accessFromRosterRows(row ? [row] : []);
}

export async function getActivityAccess(
  env: Env,
  auth: ActivityPrincipal,
): Promise<ActivityAccess> {
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

  const cached = accessFromRosterRows(result.results);
  if (cached.staff) return cached;

  // Staff metadata can change between franchise syncs. Fall back to the current
  // Sprocket franchise publication before denying Captain/AGM/GM views.
  try {
    const config = await getGuildConfig(env.DB, auth.guildId);
    if (!config) return cached;
    const livePlayers = await getFranchisePlayers(env, config.franchise_name);
    const liveRows: AccessRow[] = livePlayers
      .filter(player => player.discordId === auth.userId)
      .map(player => ({
        sprocket_player_id: player.sprocketPlayerId,
        name: player.name,
        skill_group: player.skillGroup,
        staff_position: player.staffPosition,
        slot: player.slot,
      }));
    return accessFromRosterRows([...result.results, ...liveRows]);
  } catch (error) {
    console.error("Live Activity staff fallback failed", error);
    return cached;
  }
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
