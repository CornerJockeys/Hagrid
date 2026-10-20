import {
  aggregateTeamAvailability,
  divisionCode,
  type AvailabilityRosterPlayer,
  type AvailabilitySubmission,
  type DivisionCode,
} from "../availability/team";
import type {Env} from "../types";
import {getPlayerProfileMetadata} from "../player-meta";
import {getCurrentCompetitiveFranchiseRoster} from "./roster";
import {activityVisibleDivisions, getActivityAccess} from "./access";
import {
  AVAILABILITY_END_MINUTE,
  AVAILABILITY_RESOLUTION_MINUTES,
  AVAILABILITY_START_MINUTE,
  parseAvailabilitySlots,
  requestedAvailabilityWeek,
} from "./availability";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

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
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;
  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember && !access.staff) {
    return Response.json(
      {error: "Your Discord account is not linked to the configured franchise."},
      {status: 403},
    );
  }
  const visibleDivisions = activityVisibleDivisions(access, auth.roleIds);
  if (visibleDivisions.length === 0) {
    return Response.json({error: "Hagrid could not determine which divisional team you can view."}, {status: 403});
  }

  const weekStart = requestedAvailabilityWeek(request);
  if (weekStart instanceof Response) return weekStart;
  const division = parseDivision(request);
  if (division instanceof Response) return division;
  if (division && !visibleDivisions.includes(division as never)) {
    return Response.json({error: "That divisional team is outside your Activity access scope."}, {status: 403});
  }

  const [rosterPlayers, submissionResult] = await Promise.all([
    getCurrentCompetitiveFranchiseRoster(env, auth.guildId),
    env.DB.prepare(
      `SELECT discord_user_id, slots_json, updated_at
       FROM availability_submissions
       WHERE guild_id = ? AND week_start = ?`,
    ).bind(auth.guildId, weekStart).all<SubmissionRow>(),
  ]);

  const roster: AvailabilityRosterPlayer[] = rosterPlayers
    .map(player => ({
      sprocketPlayerId: player.sprocketPlayerId,
      discordUserId: player.discordId,
      name: player.name,
      division: divisionCode(player.skillGroup),
      salary: player.salary,
      slot: player.slot,
      staffPosition: player.staffPosition,
    }))
    .filter(player => player.division !== null && visibleDivisions.includes(player.division as never));
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
  const metadata = await getPlayerProfileMetadata(
    env.DB,
    summary.players.map(player => player.sprocketPlayerId),
  );
  const withMetadata = (player: typeof summary.players[number]) => ({
    ...player,
    joined_date: metadata.get(player.sprocketPlayerId)?.joinedDate ?? null,
    seasons_played: metadata.get(player.sprocketPlayerId)?.seasonsPlayed ?? null,
    seasons: metadata.get(player.sprocketPlayerId)?.seasons ?? [],
  });

  return Response.json({
    week_start: weekStart,
    division: division ?? "all",
    visible_divisions: visibleDivisions,
    window: {
      start_minute: AVAILABILITY_START_MINUTE,
      end_minute: AVAILABILITY_END_MINUTE,
      base_resolution_minutes: AVAILABILITY_RESOLUTION_MINUTES,
    },
    ...summary,
    players: summary.players.map(withMetadata),
    missing: summary.missing.map(withMetadata),
  });
}
