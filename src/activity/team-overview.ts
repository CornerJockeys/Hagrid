import {divisionCode} from "../availability/team";
import {getCachedGuildConfig} from "../config-cache";
import {buildEligibilityDecay, easternCalendarDate} from "../eligibility-decay";
import {currentLeagueWeekStart, isEligibleForWeek} from "../eligibility";
import {
  getCurrentLeagueSnapshot,
  snapshotFranchiseRoleUsages,
} from "../league/cache";
import {usagePolicyForDivision, type TeamDivision} from "../league/view";
import {applyNcpToRoleUsage} from "../ncp/usage";
import {buildUsageAlerts} from "../reminders/usage-summary";
import {easternDate} from "../reminders/logic";
import {
  CURRENT_MLE_SEASON,
  S20_USAGE_REPORT_START_DATE,
  capSpaceFromKnownPlayers,
  divisionPolicy,
  teamSalaryFromKnownPlayers,
} from "../season-policy";
import {getEligibilityEvents, getLeagueEligibilityRules} from "../sprocket/eligibility-data";
import {getFranchiseRoleUsagesForSeason, type RoleUsage} from "../sprocket/role-usages";
import type {Env} from "../types";
import {activityVisibleDivisions, getActivityAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";
import {getCurrentCompetitiveFranchiseRoster} from "./roster";
import {currentEasternWeekStart} from "./week";

interface SubmissionRow {
  discord_user_id: string;
}

function salaryNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

async function currentUsage(
  env: Env,
  franchise: string,
): Promise<RoleUsage[]> {
  const snapshot = await getCurrentLeagueSnapshot(env);
  const cached = snapshot
    ? snapshotFranchiseRoleUsages(snapshot, franchise, CURRENT_MLE_SEASON)
    : [];
  const base = cached.length > 0
    ? cached
    : await getFranchiseRoleUsagesForSeason(env, franchise, CURRENT_MLE_SEASON);
  return applyNcpToRoleUsage(env.DB, franchise, CURRENT_MLE_SEASON, base);
}

export async function getTeamOverview(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;

  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember && !access.staff) {
    return Response.json(
      {error: "Your Discord account is not linked to the configured franchise."},
      {status: 403},
    );
  }

  const config = await getCachedGuildConfig(env, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const visibleDivisions = activityVisibleDivisions(access, auth.roleIds);
  if (visibleDivisions.length === 0) {
    return Response.json({error: "Hagrid could not determine which divisional team you can view."}, {status: 403});
  }

  const weekStart = currentEasternWeekStart();
  const today = easternDate();
  const eligibilityToday = easternCalendarDate();
  const eligibilityWeekStart = currentLeagueWeekStart();
  const usageActive = today >= S20_USAGE_REPORT_START_DATE;

  const [players, submissionResult, eligibilityRules, eligibilityEvents, usages] = await Promise.all([
    getCurrentCompetitiveFranchiseRoster(env, auth.guildId),
    env.DB.prepare(
      `SELECT discord_user_id
       FROM availability_submissions
       WHERE guild_id = ? AND week_start = ?`,
    ).bind(auth.guildId, weekStart).all<SubmissionRow>(),
    getLeagueEligibilityRules(env).catch(error => {
      console.error("Team Overview eligibility rules unavailable.", error);
      return [];
    }),
    getEligibilityEvents(env).catch(error => {
      console.error("Team Overview eligibility events unavailable.", error);
      return [];
    }),
    usageActive
      ? currentUsage(env, config.franchise_name).catch(error => {
          console.error("Team Overview usage unavailable.", error);
          return [];
        })
      : Promise.resolve([] as RoleUsage[]),
  ]);

  const submittedIds = new Set(submissionResult.results.map(row => row.discord_user_id));

  const teams = visibleDivisions.map(division => {
    const roster = players
      .filter(player => divisionCode(player.skillGroup) === division)
      .sort((left, right) =>
        (left.slot ?? "").localeCompare(right.slot ?? "", "en-US", {numeric: true}) ||
        left.name.localeCompare(right.name),
      );

    const eligibleCount = roster.filter(player => {
      const rule = eligibilityRules.find(value =>
        value.leagueCode.trim().toLocaleUpperCase("en-US") === division,
      ) ?? null;
      if (!rule) return isEligibleForWeek(player.eligibleThrough, eligibilityWeekStart);
      const events = eligibilityEvents.filter(event => event.playerId === player.sprocketPlayerId);
      const decay = buildEligibilityDecay(events, rule.requirement, eligibilityToday);
      return decay.find(point => point.isToday)?.eligible ??
        isEligibleForWeek(player.eligibleThrough, eligibilityWeekStart);
    }).length;

    const policy = divisionPolicy(division);
    const salaries = roster.map(player => player.salary);
    const teamSalary = teamSalaryFromKnownPlayers(division, salaries);
    const capSpace = capSpaceFromKnownPlayers(division, salaries);

    const divisionUsages = usages.filter(usage => {
      const code = divisionCode(usage.league);
      return code === division;
    });
    const usageAlerts = usageActive
      ? buildUsageAlerts(division, roster, divisionUsages)
      : [];

    const linked = roster.filter(player => Boolean(player.discordId)).length;
    const submitted = roster.filter(player =>
      Boolean(player.discordId && submittedIds.has(player.discordId)),
    ).length;

    return {
      division,
      roster_count: roster.length,
      eligibility: {
        eligible: eligibleCount,
        attention: Math.max(0, roster.length - eligibleCount),
      },
      salary: {
        team_salary: salaryNumber(teamSalary),
        cap: policy.salaryCap,
        cap_space: salaryNumber(capSpace),
        counted_players: Math.min(
          roster.filter(player => typeof player.salary === "number").length,
          policy.teamSalaryPlayers,
        ),
        salary_player_limit: policy.teamSalaryPlayers,
      },
      usage: {
        active: usageActive,
        data_available: divisionUsages.length > 0,
        warning_slots: usageAlerts.length,
        tracked_slots: divisionUsages.length,
        roster_slots: usagePolicyForDivision(division).rosterSlots,
        starts_on: S20_USAGE_REPORT_START_DATE,
      },
      availability: {
        week_start: weekStart,
        submitted,
        missing: Math.max(0, roster.length - submitted),
        linked,
        roster: roster.length,
      },
    };
  });

  return Response.json({
    franchise: config.franchise_name,
    today,
    week_start: weekStart,
    visible_divisions: visibleDivisions,
    teams,
  });
}
