import {discordAutocomplete, discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {currentLeagueWeekStart, eligibilityCalendarDate, isEligibleForWeek} from "../eligibility";
import {
  getLeagueSnapshotInfo,
  getPlayerScrimStats,
  getTeamRoleUsage,
  resolveLeaguePlayer,
  resolveLeagueTeam,
  searchLeaguePlayers,
  type LeaguePlayerRow,
  type LeagueScrimStatRow,
} from "../league/db";
import {ensureLeagueSnapshot} from "../league/refresh";
import {
  formatEasternTimestamp,
  formatSalary,
  slotLabel,
  teamDivision,
  usageForPlayer,
} from "../league/view";
import {CURRENT_MLE_SEASON, SCRIM_STATS_START_DATE} from "../season-policy";
import {getRocketLeaguePlayers} from "../sprocket/players";
import type {DiscordInteraction, Env, ExecutionContextLike} from "../types";

const STAT_TYPES = new Set(["Game", "Scrim"] as const);
type StatType = "Game" | "Scrim";
const MODES = new Set(["2s", "3s", "Both"] as const);
type Mode = "2s" | "3s" | "Both";

function optionValue(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function statType(interaction: DiscordInteraction): StatType | null {
  const raw = optionValue(interaction, "stats");
  return raw && STAT_TYPES.has(raw as StatType) ? raw as StatType : null;
}

function modeChoice(interaction: DiscordInteraction): Mode | null {
  const raw = optionValue(interaction, "mode") ?? "Both";
  return MODES.has(raw as Mode) ? raw as Mode : null;
}

function metric(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function scrimLine(stat: LeagueScrimStatRow): string[] {
  return [
    `**${stat.mode} — ${stat.games} games**`,
    `SR ${metric(stat.sprocket)} · OPI ${metric(stat.opi)} · DPI ${metric(stat.dpi)} · Win ${pct(stat.win_pct)}`,
    `G ${metric(stat.goals)} · A ${metric(stat.assists)} · Sv ${metric(stat.saves)} · Sh ${metric(stat.shots)} · Demos ${metric(stat.demos)}`,
  ];
}

function profileLines(player: LeaguePlayerRow, weekStart: string): string[] {
  const division = teamDivision(player.skill_group) ?? player.skill_group ?? "Unknown division";
  const eligible = isEligibleForWeek(player.eligible_through, weekStart);
  const through = eligibilityCalendarDate(player.eligible_through);
  return [
    `**${player.name}**`,
    `${player.franchise_name} · ${division} · Slot ${slotLabel(player.slot)}`,
    `Salary ${formatSalary(player.salary)} · Scrim points ${player.current_scrim_points}`,
    `${eligible ? "✅ Eligible" : "❌ Not eligible"} for week of ${weekStart}${through ? ` · source through ${through}` : ""}`,
  ];
}

async function fetchAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  requestedPlayer: string,
  stats: StatType,
  mode: Mode,
): Promise<void> {
  try {
    await ensureLeagueSnapshot(env);
    const player = await resolveLeaguePlayer(env.DB, requestedPlayer);
    if (!player) {
      const suggestions = await searchLeaguePlayers(env.DB, requestedPlayer, 5);
      const hint = suggestions.length > 0
        ? ` Try the autocomplete result for ${suggestions.map(value => `${value.name} (${value.franchise_name})`).join(", ")}.`
        : "";
      await editOriginalInteraction(interaction, `I couldn't uniquely resolve that player.${hint}`);
      return;
    }

    const [state, scrimStats, rosterTeam] = await Promise.all([
      getLeagueSnapshotInfo(env.DB),
      getPlayerScrimStats(env.DB, player.sprocket_player_id),
      resolveLeagueTeam(env.DB, player.franchise_name),
    ]);

    const weekStart = currentLeagueWeekStart();
    const lines = profileLines(player, weekStart);

    if (rosterTeam && player.slot && teamDivision(player.skill_group)) {
      const usages = await getTeamRoleUsage(env.DB, rosterTeam.franchise_name, CURRENT_MLE_SEASON);
      if ((state?.usage_count ?? 0) === 0) {
        lines.push(`Usage: awaiting S${CURRENT_MLE_SEASON} data.`);
      } else {
        const usage = usageForPlayer(player, usages);
        lines.push(
          usage
            ? `Current slot usage (2s/3s/total): ${usage.doubles_uses}/${usage.standard_uses}/${usage.total_uses}`
            : `Current slot usage: no S${CURRENT_MLE_SEASON} usage recorded for this slot.`,
        );
      }
    }

    lines.push("");
    if (stats === "Game") {
      lines.push(
        `**S${CURRENT_MLE_SEASON} Game Stats**`,
        `Awaiting the S${CURRENT_MLE_SEASON} official player game-stat dataset. Older-season game data is intentionally not used.`,
      );
    } else {
      const selected = scrimStats.filter(stat => mode === "Both" || stat.mode === mode);
      lines.push(`**S${CURRENT_MLE_SEASON} Scrim Stats · ${SCRIM_STATS_START_DATE}+**`);
      if (selected.length === 0) {
        lines.push(`No ${mode === "Both" ? "2s/3s" : mode} scrim stats were found for this player.`);
      } else {
        for (const stat of selected) {
          lines.push(...scrimLine(stat), "");
        }
        if (lines.at(-1) === "") lines.pop();
      }
    }

    lines.push("", `Data as of ${formatEasternTimestamp(state?.source_as_of ?? state?.refreshed_at ?? null)}.`);
    await editOriginalInteraction(interaction, lines.join("\n").slice(0, 1950));
  } catch (error) {
    console.error("Player lookup failed", error);
    try {
      await editOriginalInteraction(interaction, "Hagrid hit an error while building that player profile.");
    } catch (responseError) {
      console.error("Failed to report player lookup error", responseError);
    }
  }
}

export async function handlePlayerAutocomplete(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const focused = interaction.data?.options?.find(option => option.focused);
  const query = typeof focused?.value === "string" ? focused.value : "";

  try {
    let players = await searchLeaguePlayers(env.DB, query, 25);
    if (players.length === 0) {
      const live = await getRocketLeaguePlayers(env);
      const needle = query.trim().toLocaleLowerCase("en-US");
      players = live
        .filter(player =>
          !needle ||
          player.name.toLocaleLowerCase("en-US").includes(needle) ||
          player.sprocketPlayerId.toLocaleLowerCase("en-US").includes(needle),
        )
        .slice(0, 25)
        .map(player => ({
          sprocket_player_id: player.sprocketPlayerId,
          member_id: player.memberId,
          discord_id: player.discordId,
          name: player.name,
          salary: player.salary,
          skill_group: player.skillGroup,
          game_id: player.gameId,
          game_title: player.gameTitle,
          franchise_name: player.franchise,
          staff_position: player.staffPosition,
          slot: player.slot,
          current_scrim_points: player.currentScrimPoints,
          eligible_through: player.eligibleThrough,
          source_as_of: player.sourceAsOf,
          refreshed_at: "",
        }));
    }

    return discordAutocomplete(players.map(player => {
      const division = teamDivision(player.skill_group) ?? player.skill_group ?? "—";
      return {
        name: `${player.name} — ${player.franchise_name} · ${division}`.slice(0, 100),
        value: player.sprocket_player_id,
      };
    }));
  } catch (error) {
    console.error("Player autocomplete failed", error);
    return discordAutocomplete([]);
  }
}

export async function handlePlayerCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!interaction.guild_id) return discordMessage("Player lookup can only be used inside a Discord server.");
  const requestedPlayer = optionValue(interaction, "player")?.trim();
  if (!requestedPlayer) return discordMessage("Choose a player to look up.");

  const stats = statType(interaction);
  if (!stats) return discordMessage("Choose Game or Scrim stats.");
  const mode = modeChoice(interaction);
  if (!mode) return discordMessage("Unknown mode selection.");
  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  ctx.waitUntil(fetchAndRespond(interaction, env, requestedPlayer, stats, mode));
  return discordDeferred(false);
}
