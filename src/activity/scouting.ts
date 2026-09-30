import type {Env} from "../types";
import type {LeagueCode, ScoutingBucket} from "../scouting/calculate";
import {ensureScoutingSnapshot} from "../scouting/refresh";
import {
  getScoutingPlayer,
  queryScouting,
  type ScoutingFilters,
  type ScoutingViewMode,
} from "../scouting/query";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

const LEAGUES = new Set<LeagueCode>(["FL", "AL", "CL", "ML", "PL"]);
const MODES = new Set<ScoutingViewMode>(["2s", "3s", "combined"]);
const BUCKETS = new Set<ScoutingBucket>(["Hot", "Warm", "Cold"]);
const SORTS = new Set<NonNullable<ScoutingFilters["sort"]>>([
  "efficiency",
  "gpi",
  "opi",
  "dpi",
  "win_pct",
  "games",
  "salary",
  "temp",
]);

function optionalNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolParam(value: string | null): boolean {
  return value === "1" || value?.toLocaleLowerCase("en-US") === "true";
}

function cleanSearch(value: string | null): string | null {
  const cleaned = value?.trim() ?? "";
  return cleaned ? cleaned.slice(0, 100) : null;
}

export async function getActivityScouting(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request);
  if (isAuthResponse(auth)) return auth;

  await ensureScoutingSnapshot(env);

  const params = new URL(request.url).searchParams;
  const leagueRaw = params.get("league")?.toLocaleUpperCase("en-US") ?? "";
  const modeRaw = params.get("mode")?.toLocaleLowerCase("en-US") ?? "";
  const bucketRaw = params.get("temperature") ?? "";
  const sortRaw = params.get("sort") ?? "efficiency";
  const minGamesRaw = optionalNumber(params.get("min_games"));
  const limitRaw = optionalNumber(params.get("limit"));

  const filters: ScoutingFilters = {
    search: cleanSearch(params.get("search")),
    league: LEAGUES.has(leagueRaw as LeagueCode) ? leagueRaw as LeagueCode : null,
    mode: MODES.has(modeRaw as ScoutingViewMode) ? modeRaw as ScoutingViewMode : null,
    bucket: BUCKETS.has(bucketRaw as ScoutingBucket) ? bucketRaw as ScoutingBucket : null,
    role: cleanSearch(params.get("role")),
    minGames: minGamesRaw === null ? 0 : Math.max(0, Math.floor(minGamesRaw)),
    salaryMin: optionalNumber(params.get("salary_min")),
    salaryMax: optionalNumber(params.get("salary_max")),
    hideLowSample: boolParam(params.get("hide_low_sample")),
    sort: SORTS.has(sortRaw as NonNullable<ScoutingFilters["sort"]>)
      ? sortRaw as NonNullable<ScoutingFilters["sort"]>
      : "efficiency",
    limit: limitRaw === null ? 25 : Math.max(1, Math.min(50, Math.floor(limitRaw))),
  };

  const result = await queryScouting(env, filters);
  return Response.json(result);
}

export async function getActivityScoutingPlayer(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request);
  if (isAuthResponse(auth)) return auth;

  await ensureScoutingSnapshot(env);

  const params = new URL(request.url).searchParams;
  const sprocketPlayerId = params.get("id")?.trim() ?? "";
  const modeRaw = params.get("mode")?.toLocaleLowerCase("en-US") ?? "";
  if (!/^\d{1,20}$/.test(sprocketPlayerId)) {
    return Response.json({error: "A valid Sprocket player ID is required."}, {status: 400});
  }
  if (!MODES.has(modeRaw as ScoutingViewMode)) {
    return Response.json({error: "mode must be 2s, 3s, or combined."}, {status: 400});
  }

  const player = await getScoutingPlayer(env, sprocketPlayerId, modeRaw as ScoutingViewMode);
  if (!player) return Response.json({error: "That prospect was not found in the current board."}, {status: 404});
  return Response.json({player});
}
