import {getGuildConfig} from "../db";
import {
  buildEligibilityDecay,
  easternCalendarDate,
} from "../eligibility-decay";
import {currentLeagueWeekStart, isEligibleForWeek} from "../eligibility";
import {
  divisionCode,
  isCompetitiveAvailabilityPlayer,
  type AvailabilityRosterPlayer,
} from "../availability/team";
import {
  getEligibilityEvents,
  getLeagueEligibilityRules,
} from "../sprocket/eligibility-data";
import {getFranchisePlayers, type FranchisePlayer} from "../sprocket/players";
import type {Env} from "../types";
import {isAccessResponse, requireRosterAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

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

function playerSummary(player: FranchisePlayer): Record<string, unknown> {
  return {
    sprocket_player_id: player.sprocketPlayerId,
    name: player.name,
    division: divisionCode(player.skillGroup),
    skill_group: player.skillGroup,
    slot: player.slot,
    salary: player.salary,
    current_scrim_points: player.currentScrimPoints,
    eligible_through: player.eligibleThrough,
    source_as_of: player.sourceAsOf,
  };
}

export async function getActivityEligibility(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;
  const access = await requireRosterAccess(env, auth);
  if (isAccessResponse(access)) return access;

  const config = await getGuildConfig(env.DB, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const requested = new URL(request.url).searchParams.get("player_id")?.trim() ?? "";
  if (requested && !/^\d{1,20}$/.test(requested)) {
    return Response.json({error: "player_id must be a valid Sprocket player ID."}, {status: 400});
  }
  if (requested && requested !== access.playerId && !access.staff) {
    return Response.json({error: "Players can only view their own eligibility tracker."}, {status: 403});
  }

  const [players, events, rules] = await Promise.all([
    getFranchisePlayers(env, config.franchise_name),
    getEligibilityEvents(env),
    getLeagueEligibilityRules(env),
  ]);

  const competitive = players
    .map(player => ({player, roster: rosterShape(player)}))
    .filter(value => isCompetitiveAvailabilityPlayer(value.roster))
    .sort((left, right) =>
      (left.roster.division ?? "").localeCompare(right.roster.division ?? "") ||
      left.player.name.localeCompare(right.player.name),
    );

  let playerId = requested || access.playerId || "";
  if (access.staff && !requested && !competitive.some(value => value.player.sprocketPlayerId === playerId)) {
    playerId = competitive[0]?.player.sprocketPlayerId ?? playerId;
  }

  const player = players.find(value => value.sprocketPlayerId === playerId);
  if (!player) {
    return Response.json({error: "That player is not on the current configured franchise roster."}, {status: 404});
  }

  const division = divisionCode(player.skillGroup);
  const rule = rules.find(value =>
    division
      ? value.leagueCode.toLocaleUpperCase("en-US") === division
      : value.leagueName.localeCompare(player.skillGroup ?? "", "en-US", {sensitivity: "base"}) === 0,
  );
  if (!rule) {
    return Response.json({error: "Hagrid could not find the eligibility requirement for this player's division."}, {status: 502});
  }

  const playerEvents = events.filter(event => event.playerId === player.sprocketPlayerId);
  const today = easternCalendarDate();
  const weekStart = currentLeagueWeekStart();
  const decay = buildEligibilityDecay(playerEvents, rule.requirement, today);
  const todayPoint = decay.find(point => point.isToday) ?? null;

  return Response.json({
    player: playerSummary(player),
    requirement: rule.requirement,
    today,
    week_start: weekStart,
    current_week_eligible: todayPoint?.eligible ?? false,
    source_week_eligible: isEligibleForWeek(player.eligibleThrough, weekStart),
    calculated_current_points: todayPoint?.points ?? 0,
    event_count: playerEvents.length,
    decay,
    selectable_players: access.staff
      ? competitive.map(value => ({
          sprocket_player_id: value.player.sprocketPlayerId,
          name: value.player.name,
          division: value.roster.division,
          slot: value.player.slot,
        }))
      : [],
  });
}
