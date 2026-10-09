import type {Env} from "../types";
import {exchangeActivityCode} from "./auth";
import {
  getActivityContext,
  getMyAvailability,
  saveMyAvailability,
} from "./availability";
import {getActivityScouting, getActivityScoutingPlayer} from "./scouting";
import {getActivityEligibility} from "./eligibility";
import {getTeamEligibility} from "./team-eligibility";
import {getTeamAvailability} from "./team-availability";
import {getActivityStats} from "./stats";
import {getActivityStandings} from "./standings";
import {getActivitySchedule} from "./schedule";
import {getActivityRulebook} from "./rulebook";

function methodNotAllowed(): Response {
  return Response.json({error: "Method not allowed."}, {status: 405});
}

export async function handleActivityApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/activity/token") {
    return request.method === "POST"
      ? exchangeActivityCode(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/context") {
    return request.method === "GET"
      ? getActivityContext(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/availability") {
    if (request.method === "GET") return getMyAvailability(request, env);
    if (request.method === "PUT") return saveMyAvailability(request, env);
    return methodNotAllowed();
  }

  if (url.pathname === "/api/activity/availability/team") {
    return request.method === "GET"
      ? getTeamAvailability(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/eligibility") {
    return request.method === "GET"
      ? getActivityEligibility(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/eligibility/team") {
    return request.method === "GET"
      ? getTeamEligibility(request, env)
      : methodNotAllowed();
  }


  if (url.pathname === "/api/activity/stats") {
    return request.method === "GET"
      ? getActivityStats(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/schedule") {
    return request.method === "GET"
      ? getActivitySchedule(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/standings") {
    return request.method === "GET"
      ? getActivityStandings(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/rulebook") {
    return request.method === "GET"
      ? getActivityRulebook(request, env)
      : methodNotAllowed();
  }
  if (url.pathname === "/api/activity/scouting") {
    return request.method === "GET"
      ? getActivityScouting(request, env)
      : methodNotAllowed();
  }

  if (url.pathname === "/api/activity/scouting/player") {
    return request.method === "GET"
      ? getActivityScoutingPlayer(request, env)
      : methodNotAllowed();
  }

  return Response.json({error: "Unknown Activity API route."}, {status: 404});
}
