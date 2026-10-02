import {
  aggregateTeamAvailability,
  divisionCode,
  type AvailabilityRosterPlayer,
  type AvailabilitySubmission,
  type DivisionCode,
} from "../availability/team";
import type {Env} from "../types";
import {isAccessResponse, requireCaptainPlusAccess} from "./access";
import {
  AVAILABILITY_END_MINUTE,
  AVAILABILITY_RESOLUTION_MINUTES,
  AVAILABILITY_START_MINUTE,
  parseAvailabilitySlots,
  requestedAvailabilityWeek,
} from "./availability";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

interface RosterRow {
  sprocket_player_id: string;
  discord_id: string | null;
  name: string;
  skill_group: string | null;
  salary: number | null;
  slot: string | null;
  staff_position: string | null;
}

interface SubmissionRow {
  discord_user_id: string;
  slots_json: string;
  updated_at: string;
}

const DIVISIONS = new Set<DivisionCode>(["FL", "AL", "CL", "ML", "PL"]);

function parseDivision(request: Request): DivisionCode | null | Response {
  const raw = new URL(request.url).searchParams.get("division")?.trim() ?? "";
  if (!raw || raw.toLocaleLowerCase("en-US") === "all") return null;
  const normalized = raw.toLocaleUpperCase("en-US") as DivisionCode;
  if (!DIVISIONS.has(normalized)) {
    return Response.json({error: "division must be FL, AL, CL, ML, PL, or all."}, {status: 400});
  }
  return normalized;
}

function rosterPlayer(row: RosterRow): AvailabilityRosterPlayer {
  return {
    sprocketPlayerId: row.sprocket_player_id,
    discordUserId: row.discord_id,
    name: row.name,
    division: divisionCode(row.skill_group),
    salary: row.salary,
    slot: row.slot,
    staffPosition: row.staff_position,
  };
}

function submission(row: SubmissionRow): AvailabilitySubmission | null {
  try {
    const slots = parseAvailabilitySlots(JSON.parse(row.slots_json));
    if (!slots) return null;
    return {
      discordUserId: row.discord_user_id,
      slots,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function getTeamAvailability(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request);
  if (isAuthResponse(auth)) return auth;
  const access = await requireCaptainPlusAccess(env, auth);
  if (isAccessResponse(access)) return access;

  const weekStart = requestedAvailabilityWeek(request);
  if (weekStart instanceof Response) return weekStart;
  const division = parseDivision(request);
  if (division instanceof Response) return division;

  const [rosterResult, submissionResult] = await Promise.all([
    env.DB.prepare(
      `SELECT sprocket_player_id, discord_id, name, skill_group, salary, slot, staff_position
       FROM franchise_players_current
       WHERE guild_id = ?
       ORDER BY skill_group, name COLLATE NOCASE`,
    ).bind(auth.guildId).all<RosterRow>(),
    env.DB.prepare(
      `SELECT discord_user_id, slots_json, updated_at
       FROM availability_submissions
       WHERE guild_id = ? AND week_start = ?`,
    ).bind(auth.guildId, weekStart).all<SubmissionRow>(),
  ]);

  const roster = rosterResult.results.map(rosterPlayer);
  const submissions = submissionResult.results
    .map(submission)
    .filter((value): value is AvailabilitySubmission => value !== null);

  const summary = aggregateTeamAvailability(
    roster,
    submissions,
    AVAILABILITY_START_MINUTE,
    AVAILABILITY_END_MINUTE,
    AVAILABILITY_RESOLUTION_MINUTES,
    division,
  );

  return Response.json({
    week_start: weekStart,
    division: division ?? "all",
    window: {
      start_minute: AVAILABILITY_START_MINUTE,
      end_minute: AVAILABILITY_END_MINUTE,
      base_resolution_minutes: AVAILABILITY_RESOLUTION_MINUTES,
    },
    ...summary,
  });
}
