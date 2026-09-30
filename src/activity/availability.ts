import {getGuildConfig} from "../db";
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

export const EASTERN_TIME_ZONE = "America/New_York";
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

function easternDateParts(now = new Date()): {year: number; month: number; day: number; weekday: string} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const values = new Map(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    weekday: values.get("weekday") ?? "Mon",
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function currentEasternWeekStart(now = new Date()): string {
  const parts = easternDateParts(now);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (weekdayIndex + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return isoDate(date);
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

async function principal(request: Request): Promise<ActivityPrincipal | Response> {
  return authenticateActivityRequest(request);
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
  auth: ActivityPrincipal,
  weekStart: string,
): Promise<AvailabilitySlot[]> {
  const row = await env.DB
    .prepare(
      `SELECT slots_json
       FROM availability_submissions
       WHERE guild_id = ? AND week_start = ? AND discord_user_id = ?`,
    )
    .bind(auth.guildId, weekStart, auth.userId)
    .first<AvailabilityRow>();

  if (!row) return [];

  try {
    return parseAvailabilitySlots(JSON.parse(row.slots_json)) ?? [];
  } catch {
    console.error("Invalid stored availability JSON", auth.guildId, weekStart, auth.userId);
    return [];
  }
}

export async function getActivityContext(request: Request, env: Env): Promise<Response> {
  const auth = await principal(request);
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
  const auth = await principal(request);
  if (isAuthResponse(auth)) return auth;
  const access = await requireRosterAccess(env, auth);
  if (isAccessResponse(access)) return access;

  const weekStart = requestedAvailabilityWeek(request);
  if (weekStart instanceof Response) return weekStart;

  const slots = await readAvailability(env, auth, weekStart);
  return Response.json({
    week_start: weekStart,
    previous_week_start: shiftAvailabilityWeek(weekStart, -1),
    slots,
  });
}

export async function saveMyAvailability(request: Request, env: Env): Promise<Response> {
  const auth = await principal(request);
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
