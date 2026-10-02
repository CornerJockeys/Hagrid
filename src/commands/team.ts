import {discordAutocomplete, discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {currentLeagueWeekStart, isEligibleForWeek} from "../eligibility";
import {
  getLeagueSnapshotInfo,
  getLeagueTeamPlayers,
  getTeamRoleUsage,
  resolveLeagueTeam,
  searchLeagueTeams,
  type LeaguePlayerRow,
  type LeagueScrimStatRow,
  type LeagueUsageRow,
} from "../league/db";
import {
  formatEasternTimestamp,
  formatSalary,
  isCompetitiveSlot,
  slotLabel,
  teamDivision,
  teamDivisionOrder,
  usageForPlayer,
  type TeamDivision,
} from "../league/view";
import {CURRENT_MLE_SEASON} from "../season-policy";
import {getFranchises, resolveFranchise} from "../sprocket/franchises";
import {getFranchisePlayers} from "../sprocket/players";
import {getFranchiseRoleUsagesForSeason} from "../sprocket/role-usages";
import {getScoutingStatLines} from "../sprocket/scouting";
import {leaguePlayerFromFranchise, leagueScrimFromSource, leagueUsageFromSource, latestSourceTimestamp, safeCommandError} from "./live-data";
import type {DiscordInteraction, Env, ExecutionContextLike} from "../types";

const DIVISIONS = new Set<TeamDivision>(["FL", "AL", "CL", "ML"]);

function optionValue(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function selectedDivision(interaction: DiscordInteraction): TeamDivision | null | "invalid" {
  const raw = optionValue(interaction, "division");
  if (!raw) return null;
  const normalized = raw.toLocaleUpperCase("en-US") as TeamDivision;
  return DIVISIONS.has(normalized) ? normalized : "invalid";
}

function usageText(usage: LeagueUsageRow | null): string {
  if (!usage) return "U —";
  return `U 2s ${usage.doubles_uses}/6 · 3s ${usage.standard_uses}/8 · T ${usage.total_uses}/12`;
}

function metric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function scrimText(stats: LeagueScrimStatRow[]): string {
  if (stats.length === 0) return "Scrim stats —";
  return stats
    .sort((a, b) => a.mode.localeCompare(b.mode))
    .map(stat => `${stat.mode} ${stat.games}g SR ${metric(stat.sprocket)} OPI ${metric(stat.opi)} DPI ${metric(stat.dpi)}`)
    .join(" | ");
}

function playerLine(
  player: LeaguePlayerRow,
  usages: LeagueUsageRow[],
  weekStart: string,
  usageAvailable: boolean,
  scrimStats: LeagueScrimStatRow[] = [],
  includeScrims = false,
): string {
  const eligible = isEligibleForWeek(player.eligible_through, weekStart);
  const usage = usageAvailable ? usageForPlayer(player, usages) : null;
  const parts = [
    `\`${slotLabel(player.slot)}\``,
    `Salary ${formatSalary(player.salary)}`,
    `**${player.name}**`,
    eligible ? "✅ Eligible" : "❌ Not eligible",
    `SP ${player.current_scrim_points}`,
  ];
  if (usageAvailable) parts.push(usageText(usage));
  if (includeScrims) parts.push(scrimText(scrimStats));
  return parts.join(" · ");
}

function freshnessLines(sourceAsOf: string | null, refreshedAt: string | null): string[] {
  const lines: string[] = [];
  if (sourceAsOf) lines.push(`Source as of ${formatEasternTimestamp(sourceAsOf)}.`);
  if (refreshedAt) lines.push(`Hagrid refreshed ${formatEasternTimestamp(refreshedAt)}.`);
  return lines;
}

function teamContent(
  teamName: string,
  teamCode: string | null,
  players: LeaguePlayerRow[],
  usages: LeagueUsageRow[],
  division: TeamDivision | null,
  usageCount: number,
  sourceAsOf: string | null,
  refreshedAt: string | null,
  scrimStats: Map<string, LeagueScrimStatRow[]> = new Map(),
  includeScrims = false,
): string {
  const weekStart = currentLeagueWeekStart();
  const competitive = players
    .filter(player => isCompetitiveSlot(player.slot))
    .map(player => ({player, division: teamDivision(player.skill_group)}))
    .filter((entry): entry is {player: LeaguePlayerRow; division: TeamDivision} => entry.division !== null)
    .filter(entry => !division || entry.division === division)
    .sort((left, right) =>
      teamDivisionOrder(left.division) - teamDivisionOrder(right.division) ||
      slotLabel(left.player.slot).localeCompare(slotLabel(right.player.slot), "en-US", {numeric: true}) ||
      left.player.name.localeCompare(right.player.name),
    );

  const heading = `**${teamName}${teamCode ? ` (${teamCode})` : ""} — Roster**`;
  if (competitive.length === 0) {
    return [
      heading,
      division ? `No competitive ${division} roster entries were found.` : "No competitive roster entries were found.",
      ...freshnessLines(sourceAsOf, refreshedAt),
    ].join("\n");
  }

  const usageAvailable = usageCount > 0;
  const lines: string[] = [heading];
  const grouped = new Map<TeamDivision, LeaguePlayerRow[]>();
  for (const entry of competitive) {
    const values = grouped.get(entry.division) ?? [];
    values.push(entry.player);
    grouped.set(entry.division, values);
  }

  for (const key of (["ML", "CL", "AL", "FL"] as TeamDivision[])) {
    const values = grouped.get(key);
    if (!values?.length) continue;
    lines.push("", `**${key}**`);
    for (const player of values) {
      lines.push(playerLine(
        player,
        usages,
        weekStart,
        usageAvailable,
        scrimStats.get(player.sprocket_player_id) ?? [],
        includeScrims,
      ));
    }
  }

  lines.push("", `Eligibility is evaluated for the week beginning ${weekStart}.`);
  lines.push(
    usageAvailable
      ? `Usage is S${CURRENT_MLE_SEASON} slot usage shown as 2s/3s/total.`
      : `Usage: awaiting S${CURRENT_MLE_SEASON} data.`,
  );
  lines.push(...freshnessLines(sourceAsOf, refreshedAt));
  return lines.join("\n");
}

async function fetchAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  requestedTeam: string,
  division: TeamDivision | null,
  includeScrims: boolean,
): Promise<void> {
  try {
    const resolution = await resolveFranchise(env, requestedTeam);
    const team = resolution.match;
    if (!team) {
      const hint = resolution.suggestions.length > 0
        ? ` Try: ${resolution.suggestions.map(value => value.name).join(", ")}.`
        : "";
      await editOriginalInteraction(interaction, `I couldn't resolve that team.${hint}`);
      return;
    }

    const [sourcePlayers, sourceUsages, sourceScrims] = await Promise.all([
      getFranchisePlayers(env, team.name),
      getFranchiseRoleUsagesForSeason(env, team.name, CURRENT_MLE_SEASON),
      includeScrims ? getScoutingStatLines(env) : Promise.resolve([]),
    ]);
    const players = sourcePlayers.map(leaguePlayerFromFranchise);
    const usages = sourceUsages.map(leagueUsageFromSource);
    const playerIds = new Set(players.map(player => player.sprocket_player_id));
    const scrimStats = new Map<string, LeagueScrimStatRow[]>();
    if (includeScrims) {
      for (const stat of sourceScrims.filter(value => playerIds.has(value.sprocketPlayerId)).map(leagueScrimFromSource)) {
        const rows = scrimStats.get(stat.sprocket_player_id) ?? [];
        rows.push(stat);
        scrimStats.set(stat.sprocket_player_id, rows);
      }
    }
    const sourceAsOf = latestSourceTimestamp([
      ...sourcePlayers.map(player => player.sourceAsOf),
      ...sourceUsages.map(usage => usage.sourceAsOf),
    ]);

    const content = teamContent(
      team.name,
      team.code,
      players,
      usages,
      division,
      usages.length,
      sourceAsOf,
      null,
      scrimStats,
      includeScrims,
    );
    await editOriginalInteraction(interaction, content.slice(0, 1950));
  } catch (error) {
    console.error("Team lookup failed", error);
    const detail = safeCommandError(error);
    try {
      await editOriginalInteraction(
        interaction,
        `Hagrid hit an error while building that team roster.\n\n` +
          `Diagnostic: \`${detail || "unknown error"}\``,
      );
    } catch (responseError) {
      console.error("Failed to report team lookup error", responseError);
    }
  }
}

export async function handleTeamAutocomplete(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const focused = interaction.data?.options?.find(option => option.focused);
  const query = typeof focused?.value === "string" ? focused.value : "";

  try {
    let teams = await searchLeagueTeams(env.DB, query, 25);
    if (teams.length === 0) {
      const live = await getFranchises(env);
      const needle = query.trim().toLocaleLowerCase("en-US");
      teams = live
        .filter(team =>
          !needle ||
          team.name.toLocaleLowerCase("en-US").includes(needle) ||
          (team.code ?? "").toLocaleLowerCase("en-US").includes(needle),
        )
        .slice(0, 25)
        .map(team => ({
          franchise_name: team.name,
          franchise_code: team.code,
          conference: team.conference,
          super_division: team.superDivision,
          division: team.division,
          refreshed_at: "",
        }));
    }
    return discordAutocomplete(teams.map(team => ({
      name: `${team.franchise_name}${team.franchise_code ? ` (${team.franchise_code})` : ""}`.slice(0, 100),
      value: team.franchise_name,
    })));
  } catch (error) {
    console.error("Team autocomplete failed", error);
    return discordAutocomplete([]);
  }
}

export async function handleTeamCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!interaction.guild_id) return discordMessage("Team lookup can only be used inside a Discord server.");
  const requestedTeam = optionValue(interaction, "team")?.trim();
  if (!requestedTeam) return discordMessage("Choose a team to look up.");

  const division = selectedDivision(interaction);
  if (division === "invalid") return discordMessage("Unknown division selection.");
  const includeScrims = interaction.data?.options?.find(option => option.name === "scrims")?.value === true;
  if (includeScrims && !division) {
    return discordMessage("Choose a division when including scrim performance stats so the team response stays readable.");
  }
  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  ctx.waitUntil(fetchAndRespond(interaction, env, requestedTeam, division, includeScrims));
  return discordDeferred(false);
}
