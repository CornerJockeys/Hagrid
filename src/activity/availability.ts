import {getGuildConfig} from "../db";
import {isCompetitiveSlot, teamDivision} from "../league/view";
import {getFranchisePlayers, type FranchisePlayer} from "../sprocket/players";
import type {Env} from "../types";
import {
  getActivityAccess,
  isAccessResponse,
  requireRosterAccess,
} from "./access";
import {
  authenticateActivityRequest,
  isAuthResponse,
  type ActivityPrincipal,
} from "./auth";
import {currentEasternWeekStart, EASTERN_TIME_ZONE} from "./week";

export {currentEasternWeekStart, EASTERN_TIME_ZONE};
export const AVAILABILITY_START_MINUTE = 12 * 60;
export const AVAILABILITY_END_MINUTE = 24 * 60;
export const AVAILABILITY_RESOLUTION_MINUTES = 30;
const MAX_SLOTS = 7 * ((AVAILABILITY_END_MINUTE - AVAILABILITY_START_MINUTE) / AVAILABILITY_RESOLUTION_MINUTES);

export interface AvailabilitySlot {
  day: number;
  minute: number;
  state: 1 | 2;
}

interface AvailabilityRow {
  slots_json: string;
}

function errorResponse(message: string, status = 400): Response {
  return Response.json({error: message}, {status});
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftAvailabilityWeek(weekStart: string, weeks: number): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return isoDate(date);
}

export function validAvailabilityWeekStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && isoDate(date) === value && date.getUTCDay() === 1;
}

export function requestedAvailabilityWeek(request: Request): string | Response {
  const value = new URL(request.url).searchParams.get("week") ?? currentEasternWeekStart();
  return validAvailabilityWeekStart(value)
    ? value
    : errorResponse("week must be a Monday in YYYY-MM-DD format.");
}

async function principal(request: Request, env: Env): Promise<ActivityPrincipal | Response> {
  return authenticateActivityRequest(request, env);
}

export function parseAvailabilitySlots(value: unknown): AvailabilitySlot[] | null {
  if (!Array.isArray(value) || value.length > MAX_SLOTS) return null;
  const unique = new Map<string, AvailabilitySlot>();

  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const candidate = item as Record<string, unknown>;
    const day = candidate.day;
    const minute = candidate.minute;
    const state = candidate.state ?? 1;
    if (
      !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6 ||
      !Number.isInteger(minute) || Number(minute) < AVAILABILITY_START_MINUTE || Number(minute) >= AVAILABILITY_END_MINUTE ||
      Number(minute) % AVAILABILITY_RESOLUTION_MINUTES !== 0 ||
      (state !== 1 && state !== 2)
    ) {
      return null;
    }

    const slot: AvailabilitySlot = {
      day: Number(day),
      minute: Number(minute),
      state: state as 1 | 2,
    };
    unique.set(`${slot.day}:${slot.minute}`, slot);
  }

  return [...unique.values()].sort((a, b) => a.day - b.day || a.minute - b.minute);
}

async function readAvailability(
  env: Env,
  guildId: string,
  discordUserId: string | null,
  weekStart: string,
): Promise<AvailabilitySlot[]> {
  if (!discordUserId) return [];
  const row = await env.DB
    .prepare(
      `SELECT slots_json
       FROM availability_submissions
       WHERE guild_id = ? AND week_start = ? AND discord_user_id = ?`,
    )
    .bind(guildId, weekStart, discordUserId)
    .first<AvailabilityRow>();

  if (!row) return [];

  try {
    return parseAvailabilitySlots(JSON.parse(row.slots_json)) ?? [];
  } catch {
    console.error("Invalid stored availability JSON", guildId, weekStart, discordUserId);
    return [];
  }
}

interface CachedAvailabilityPlayerRow {
  sprocket_player_id: string;
  discord_id: string | null;
  name: string;
  salary: number | null;
  skill_group: string | null;
  franchise_name: string;
  staff_position: string | null;
  slot: string | null;
}

function cachedPlayer(row: CachedAvailabilityPlayerRow): FranchisePlayer {
  return {
    sprocketPlayerId: row.sprocket_player_id,
    memberId: null,
    discordId: row.discord_id,
    name: row.name,
    salary: row.salary,
    skillGroup: row.skill_group,
    gameId: null,
    gameTitle: "Rocket League",
    franchise: row.franchise_name,
    staffPosition: row.staff_position,
    slot: row.slot,
    currentScrimPoints: 0,
    eligibleThrough: null,
    sourceAsOf: null,
  };
}

export async function getAvailabilityRoster(env: Env, guildId: string): Promise<FranchisePlayer[]> {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return [];

  try {
    return (await getFranchisePlayers(env, config.franchise_name))
      .filter(player => isCompetitiveSlot(player.slot));
  } catch (error) {
    console.error("Live availability roster lookup failed; using cached roster.", error);
    const result = await env.DB.prepare(
      `SELECT sprocket_player_id, discord_id, name, salary, skill_group, franchise_name,
              staff_position, slot
       FROM league_players_current
       WHERE LOWER(franchise_name) = LOWER(?)
       ORDER BY skill_group, slot, name COLLATE NOCASE`,
    ).bind(config.franchise_name).all<CachedAvailabilityPlayerRow>();
    return result.results.map(cachedPlayer).filter(player => isCompetitiveSlot(player.slot));
  }
}

export async function getActivityContext(request: Request, env: Env): Promise<Response> {
  const auth = await principal(request, env);
  if (isAuthResponse(auth)) return auth;

  const [config, access] = await Promise.all([
    getGuildConfig(env.DB, auth.guildId),
    getActivityAccess(env, auth),
  ]);
  return Response.json({
    guild_id: auth.guildId,
    user_id: auth.userId,
    display_name: auth.displayName,
    franchise: config ? {
      name: config.franchise_name,
      code: config.franchise_code,
    } : null,
    access: {
      roster_member: access.rosterMember,
      staff: access.staff,
      captain_plus: access.captainPlus,
      player_id: access.playerId,
      player_name: access.playerName,
      division: access.division,
      staff_position: access.staffPosition,
      slot: access.slot,
    },
    current_week_start: currentEasternWeekStart(),
    timezone: EASTERN_TIME_ZONE,
    window: {
      start_minute: AVAILABILITY_START_MINUTE,
      end_minute: AVAILABILITY_END_MINUTE,
      base_resolution_minutes: AVAILABILITY_RESOLUTION_MINUTES,
    },
  });
}

export async function getMyAvailability(request: Request, env: Env): Promise<Response> {
  const auth = await principal(request, env);
  if (isAuthResponse(auth)) return auth;
  const access = await getActivityAccess(env, auth);

  const weekStart = requestedAvailabilityWeek(request);
  if (weekStart instanceof Response) return weekStart;

  const roster = await getAvailabilityRoster(env, auth.guildId);
  const ownPlayer = roster.find(player => player.discordId === auth.userId) ?? null;
  const requestedPlayerId = new URL(request.url).searchParams.get("player_id")?.trim() ?? "";
  const selected = requestedPlayerId
    ? roster.find(player => player.sprocketPlayerId === requestedPlayerId) ?? null
    : ownPlayer ?? (access.captainPlus ? roster[0] ?? null : null);

  if (!selected) {
    return Response.json(
      {error: "Hagrid could not find that player on the current competitive franchise roster."},
      {status: 404},
    );
  }

  const viewingOwn = selected.discordId === auth.userId;
  if (!viewingOwn && !access.captainPlus) {
    return Response.json(
      {error: "Only current franchise Captain/AGM/GM/FM staff can view another player's availability."},
      {status: 403},
    );
  }

  const slots = await readAvailability(env, auth.guildId, selected.discordId, weekStart);
  return Response.json({
    week_start: weekStart,
    previous_week_start: shiftAvailabilityWeek(weekStart, -1),
    player: {
      sprocket_player_id: selected.sprocketPlayerId,
      name: selected.name,
      division: teamDivision(selected.skillGroup),
      slot: selected.slot,
      discord_linked: Boolean(selected.discordId),
      editable: viewingOwn,
    },
    selectable_players: access.captainPlus
      ? roster.map(player => ({
          sprocket_player_id: player.sprocketPlayerId,
          name: player.name,
          division: teamDivision(player.skillGroup),
          slot: player.slot,
        }))
      : [],
    slots,
  });
}

export async function saveMyAvailability(request: Request, env: Env): Promise<Response> {
  const auth = await principal(request, env);
  if (isAuthResponse(auth)) return auth;
  const access = await requireRosterAccess(env, auth);
  if (isAccessResponse(access)) return access;

  let body: {week_start?: unknown; slots?: unknown};
  try {
    body = await request.json() as {week_start?: unknown; slots?: unknown};
  } catch {
    return errorResponse("Invalid JSON body.");
  }

  if (typeof body.week_start !== "string" || !validAvailabilityWeekStart(body.week_start)) {
    return errorResponse("week_start must be a Monday in YYYY-MM-DD format.");
  }
  const slots = parseAvailabilitySlots(body.slots);
  if (!slots) return errorResponse("Availability contains an invalid time slot.");

  const result = await env.DB
    .prepare(
      `INSERT INTO availability_submissions (
         guild_id, week_start, discord_user_id, slots_json, updated_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id, week_start, discord_user_id)
       DO UPDATE SET slots_json = excluded.slots_json, updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(auth.guildId, body.week_start, auth.userId, JSON.stringify(slots))
    .run();

  if (!result.success) throw new Error("D1 rejected the availability update.");

  return Response.json({
    ok: true,
    week_start: body.week_start,
    slot_count: slots.length,
    updated_at: new Date().toISOString(),
  });
}
