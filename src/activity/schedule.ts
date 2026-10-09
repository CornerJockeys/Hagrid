import {getCachedGuildConfig} from "../config-cache";
import {easternCalendarDate} from "../eligibility-decay";
import {S20_SCHEDULE_BYES, S20_SCHEDULE_WEEKS} from "../schedule/s20";
import type {Env} from "../types";
import {getActivityAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

function defaultMatchWeek(today: string): number {
  const active = S20_SCHEDULE_WEEKS.find(week => today >= week.startDate && today <= week.endDate);
  if (active) return active.matchWeek;
  const upcoming = S20_SCHEDULE_WEEKS.find(week => today < week.startDate);
  return upcoming?.matchWeek ?? S20_SCHEDULE_WEEKS[S20_SCHEDULE_WEEKS.length - 1]?.matchWeek ?? 1;
}

export async function getActivitySchedule(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;

  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember && !access.staff) {
    return Response.json({error: "Roster access is required for the schedule."}, {status: 403});
  }

  const config = await getCachedGuildConfig(env, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const today = easternCalendarDate();
  return Response.json({
    franchise: config.franchise_name,
    today,
    default_match_week: defaultMatchWeek(today),
    weeks: S20_SCHEDULE_WEEKS,
    byes: S20_SCHEDULE_BYES,
  });
}
