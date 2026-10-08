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
import type {FranchisePlayer} from "../sprocket/players";
import type {Env} from "../types";
import {getActivityAccess} from "./access";
import {getCurrentCompetitiveFranchiseRoster} from "./roster";
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
  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember && !access.staff) {
    return Response.json(
      {error: "Your Discord account is not linked to the current franchise roster in Hagrid."},
      {status: 403},
    );
  }

  const config = await getGuildConfig(env.DB, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const requested = new URL(request.url).searchParams.get("player_id")?.trim() ?? "";
  if (requested && !/^\d{1,20}$/.test(requested)) {
    return Response.json({error: "player_id must be a valid Sprocket player ID."}, {status: 400});
  }
  if (requested && requested !== access.playerId && !access.captainPlus) {
    return Response.json({error: "Players can only view their own eligibility tracker."}, {status: 403});
  }

  const players = await getCurrentCompetitiveFranchiseRoster(env, auth.guildId);

  const competitive = players
    .map(player => ({player, roster: rosterShape(player)}))
    .filter(value => isCompetitiveAvailabilityPlayer(value.roster))
    .sort((left, right) =>
      (left.roster.division ?? "").localeCompare(right.roster.division ?? "") ||
      left.player.name.localeCompare(right.player.name),
    );

  let playerId = requested || access.playerId || "";
  const requestedIsCompetitive = requested
    ? competitive.some(value => value.player.sprocketPlayerId === requested)
    : false;
  if (
    access.captainPlus &&
    (!requested || (requested === access.playerId && !requestedIsCompetitive))
  ) {
    playerId = competitive[0]?.player.sprocketPlayerId ?? "";
  }

  const player = players.find(value => value.sprocketPlayerId === playerId);
  if (!player) {
    return Response.json({error: "That player is not on the current configured franchise roster."}, {status: 404});
  }

  const division = divisionCode(player.skillGroup);
  const today = easternCalendarDate();
  const weekStart = currentLeagueWeekStart();
  const sourceWeekEligible = isEligibleForWeek(player.eligibleThrough, weekStart);

  let requirement: number | null = null;
  let playerEvents: Awaited<ReturnType<typeof getEligibilityEvents>> = [];
  let decay: ReturnType<typeof buildEligibilityDecay> = [];
  let calculatedCurrentPoints: number | null = null;
  let currentWeekEligible = sourceWeekEligible;
  let detailError: string | null = null;

  try {
    const rules = await getLeagueEligibilityRules(env);
    const rule = rules.find(value =>
      division
        ? value.leagueCode.toLocaleUpperCase("en-US") === division
        : value.leagueName.localeCompare(player.skillGroup ?? "", "en-US", {sensitivity: "base"}) === 0,
    );
    if (!rule) {
      detailError = "Eligibility requirement data is temporarily unavailable for this division.";
    } else {
      requirement = rule.requirement;
      playerEvents = await getEligibilityEvents(env, player.sprocketPlayerId);
      decay = buildEligibilityDecay(playerEvents, rule.requirement, today);
      const todayPoint = decay.find(point => point.isToday) ?? null;
      calculatedCurrentPoints = todayPoint?.points ?? null;
      currentWeekEligible = todayPoint?.eligible ?? sourceWeekEligible;
    }
  } catch (error) {
    console.error("Eligibility detail source failed; returning player-feed fallback.", error);
    detailError = "Detailed eligibility history is temporarily unavailable. Current Sprocket status is shown instead.";
  }

  return Response.json({
    player: playerSummary(player),
    requirement,
    today,
    week_start: weekStart,
    current_week_eligible: currentWeekEligible,
    source_week_eligible: sourceWeekEligible,
    calculated_current_points: calculatedCurrentPoints,
    event_count: playerEvents.length,
    decay,
    detail_error: detailError,
    selectable_players: access.captainPlus
      ? competitive.map(value => ({
          sprocket_player_id: value.player.sprocketPlayerId,
          name: value.player.name,
          division: value.roster.division,
          slot: value.player.slot,
        }))
      : [],
  });
}
