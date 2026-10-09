import {getCachedGuildConfig} from "../config-cache";
import {CURRENT_MLE_SEASON} from "../season-policy";
import {sameText} from "../sprocket/fields";
import {getSeasonStandings, type StandingRow} from "../sprocket/standings";
import type {Env} from "../types";
import {getActivityAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

type Division = "FL" | "AL" | "CL" | "ML";
type DivisionFilter = "all" | Division;
type Mode = "Overall" | "Doubles" | "Standard";

const LEAGUES: Array<{short: Division; name: string}> = [
  {short: "FL", name: "Foundation League"},
  {short: "AL", name: "Academy League"},
  {short: "CL", name: "Champion League"},
  {short: "ML", name: "Master League"},
];

function parseDivision(request: Request): DivisionFilter | Response {
  const raw = new URL(request.url).searchParams.get("division")?.trim().toLocaleUpperCase("en-US") ?? "ALL";
  if (raw === "ALL") return "all";
  if (raw === "FL" || raw === "AL" || raw === "CL" || raw === "ML") return raw;
  return Response.json({error: "division must be all, FL, AL, CL, or ML."}, {status: 400});
}

function parseMode(request: Request): Mode | Response {
  const raw = new URL(request.url).searchParams.get("mode")?.trim() ?? "Overall";
  if (raw === "Overall" || raw === "Doubles" || raw === "Standard") return raw;
  return Response.json({error: "mode must be Overall, Doubles, or Standard."}, {status: 400});
}

function isPrimary(row: StandingRow): boolean {
  return row.divisionName !== null && row.conference !== null && row.league !== null;
}

function targetMode(mode: Mode): string | null {
  return mode === "Overall" ? null : mode;
}

function franchiseRow(rows: StandingRow[], franchise: string, leagueName: string, mode: Mode): StandingRow | null {
  const wantedMode = targetMode(mode);
  return rows.find(row =>
    isPrimary(row) &&
    sameText(row.name, franchise) &&
    sameText(row.league, leagueName) &&
    (wantedMode === null ? row.mode === null : sameText(row.mode, wantedMode)),
  ) ?? null;
}

function peerRows(rows: StandingRow[], current: StandingRow): StandingRow[] {
  return rows
    .filter(row =>
      isPrimary(row) &&
      row.season === current.season &&
      sameText(row.divisionName, current.divisionName) &&
      sameText(row.conference, current.conference) &&
      sameText(row.league, current.league) &&
      ((row.mode === null && current.mode === null) || sameText(row.mode, current.mode)),
    )
    .sort((a, b) => a.ranking - b.ranking || a.name.localeCompare(b.name));
}

function standingShape(row: StandingRow) {
  return {
    ranking: row.ranking,
    name: row.name,
    division_name: row.divisionName,
    conference: row.conference,
    wins: row.teamWins,
    losses: row.teamLosses,
    league: row.league,
    mode: row.mode,
    season: row.season,
    source_as_of: row.sourceAsOf,
  };
}

export async function getActivityStandings(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;
  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember && !access.staff) {
    return Response.json({error: "Roster access is required for standings."}, {status: 403});
  }

  const config = await getCachedGuildConfig(env, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const division = parseDivision(request);
  if (division instanceof Response) return division;
  const mode = parseMode(request);
  if (mode instanceof Response) return mode;

  const rows = await getSeasonStandings(env, CURRENT_MLE_SEASON);
  const selectedLeagues = division === "all" ? LEAGUES : LEAGUES.filter(value => value.short === division);
  const sections = selectedLeagues.map(league => {
    const current = franchiseRow(rows, config.franchise_name, league.name, mode);
    return {
      division: league.short,
      league_name: league.name,
      franchise: current ? standingShape(current) : null,
      table: current ? peerRows(rows, current).map(standingShape) : [],
    };
  });

  const playedGames = sections.reduce(
    (sum, section) => sum + (section.franchise ? section.franchise.wins + section.franchise.losses : 0),
    0,
  );
  const available = rows.length > 0 && playedGames > 0;

  return Response.json({
    franchise: config.franchise_name,
    season: CURRENT_MLE_SEASON,
    division,
    mode,
    available,
    message: available
      ? null
      : `S${CURRENT_MLE_SEASON} standings will populate after matches have been played and published by MLE.`,
    sections,
  });
}
