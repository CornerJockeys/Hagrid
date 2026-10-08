import {
  divisionCode,
  isCompetitiveAvailabilityPlayer,
  type AvailabilityRosterPlayer,
} from "../availability/team";
import {getCachedGuildConfig} from "../config-cache";
import {buildEligibilityDecay, easternCalendarDate} from "../eligibility-decay";
import {currentLeagueWeekStart, isEligibleForWeek} from "../eligibility";
import {getEligibilityEvents, getLeagueEligibilityRules} from "../sprocket/eligibility-data";
import type {FranchisePlayer} from "../sprocket/players";
import type {Env} from "../types";
import {authenticateActivityRequest, isAuthResponse} from "./auth";
import {isAccessResponse, requireCaptainPlusAccess} from "./access";
import {getCurrentCompetitiveFranchiseRoster} from "./roster";

type DivisionFilter = "all" | "FL" | "AL" | "CL" | "ML";

function rosterShape(player: FranchisePlayer): AvailabilityRosterPlayer {
  return {
    sprocketPlayerId: player.sprocketPlayerId,
    discordUserId: player.discordId,
    name: player.name,
    division: divisionCode(player.skillGroup),
    salary: player.salary,
    slot: player.slot,
    staffPosition: player.staffPosition,
  };
}

function normalizeDivision(value: string | null): DivisionFilter | null {
  if (!value) return "all";
  const normalized = value.trim().toLocaleUpperCase("en-US");
  if (normalized === "ALL") return "all";
  if (normalized === "FL" || normalized === "AL" || normalized === "CL" || normalized === "ML") {
    return normalized;
  }
  return null;
}

export async function getTeamEligibility(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;

  const access = await requireCaptainPlusAccess(env, auth);
  if (isAccessResponse(access)) return access;

  const config = await getCachedGuildConfig(env, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const division = normalizeDivision(new URL(request.url).searchParams.get("division"));
  if (division === null) {
    return Response.json({error: "division must be all, FL, AL, CL, or ML."}, {status: 400});
  }

  const [players, events, rules] = await Promise.all([
    getCurrentCompetitiveFranchiseRoster(env, auth.guildId),
    getEligibilityEvents(env),
    getLeagueEligibilityRules(env),
  ]);

  const today = easternCalendarDate();
  const weekStart = currentLeagueWeekStart();

  const rows = players
    .map(player => ({player, roster: rosterShape(player)}))
    .filter(value => isCompetitiveAvailabilityPlayer(value.roster))
    .filter(value => division === "all" || value.roster.division === division)
    .map(({player, roster}) => {
      const rule = rules.find(value =>
        roster.division
          ? value.leagueCode.toLocaleUpperCase("en-US") === roster.division
          : value.leagueName.localeCompare(player.skillGroup ?? "", "en-US", {sensitivity: "base"}) === 0,
      ) ?? null;

      const playerEvents = events.filter(event => event.playerId === player.sprocketPlayerId);
      const decay = rule ? buildEligibilityDecay(playerEvents, rule.requirement, today) : [];
      const todayPoint = decay.find(point => point.isToday) ?? null;

      return {
        sprocket_player_id: player.sprocketPlayerId,
        name: player.name,
        division: roster.division,
        slot: player.slot,
        salary: player.salary,
        current_scrim_points: player.currentScrimPoints,
        calculated_current_points: todayPoint?.points ?? 0,
        requirement: rule?.requirement ?? null,
        current_week_eligible: todayPoint?.eligible ?? false,
        source_week_eligible: isEligibleForWeek(player.eligibleThrough, weekStart),
        eligible_through: player.eligibleThrough,
        source_as_of: player.sourceAsOf,
      };
    })
    .sort((a, b) =>
      (a.division ?? "").localeCompare(b.division ?? "") ||
      (a.slot ?? "").localeCompare(b.slot ?? "", "en-US", {numeric: true}) ||
      a.name.localeCompare(b.name),
    );

  return Response.json({
    franchise: config.franchise_name,
    today,
    week_start: weekStart,
    division,
    players: rows,
  });
}
