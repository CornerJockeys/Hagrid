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

function textSuggestsCaptain(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return /(^|\b)(captain|capt)(\b|$)/.test(normalized);
}

export function accessFromRosterRow(row: AccessRow | null): ActivityAccess {
  if (!row) {
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

  const staffPosition = row.staff_position?.trim() || null;
  return {
    rosterMember: true,
    staff: Boolean(staffPosition) || textSuggestsCaptain(row.slot),
    playerId: row.sprocket_player_id,
    playerName: row.name,
    division: row.skill_group?.trim() || null,
    staffPosition,
    slot: row.slot?.trim() || null,
  };
}

export async function getActivityAccess(
  env: Env,
  auth: ActivityPrincipal,
): Promise<ActivityAccess> {
  const row = await env.DB.prepare(
    `SELECT sprocket_player_id, name, skill_group, staff_position, slot
     FROM franchise_players_current
     WHERE guild_id = ? AND discord_id = ?
     LIMIT 1`,
  ).bind(auth.guildId, auth.userId).first<AccessRow>();

  return accessFromRosterRow(row);
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
