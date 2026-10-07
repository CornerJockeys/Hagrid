import {discordAutocomplete, discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {currentLeagueWeekStart, eligibilityCalendarDate, isEligibleForWeek} from "../eligibility";
import {searchLeaguePlayers, type LeaguePlayerRow, type LeagueScrimStatRow} from "../league/db";
import {getCachedScoutingSnapshot} from "../scouting/cache";
import {
  formatEasternTimestamp,
  formatSalary,
  remainingUsage,
  slotLabel,
  teamDivision,
  usageForPlayer,
} from "../league/view";
import {CURRENT_MLE_SEASON, SCRIM_STATS_START_DATE} from "../season-policy";
import {getRocketLeaguePlayers} from "../sprocket/players";
import {getProspectIdentities, getScoutingStatLines} from "../sprocket/scouting";
import {getFranchiseRoleUsagesForSeason} from "../sprocket/role-usages";
import {
  leaguePlayerFromFranchise,
  leaguePlayerFromProspect,
  leagueScrimFromSource,
  leagueUsageFromSource,
  safeCommandError,
} from "./live-data";
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

function profileLines(player: LeaguePlayerRow, weekStart: string, rostered: boolean): string[] {
  const division = teamDivision(player.skill_group) ?? player.skill_group ?? "Unknown division";
  if (!rostered) {
    return [
      `**${player.name}**`,
      `Status ${player.franchise_name} · ${division}`,
      `Salary ${formatSalary(player.salary)}`,
    ];
  }

  const eligible = isEligibleForWeek(player.eligible_through, weekStart);
  const through = eligibilityCalendarDate(player.eligible_through);
  return [
    `**${player.name}**`,
    `${player.franchise_name} · ${division} · Slot ${slotLabel(player.slot)}`,
    `Salary ${formatSalary(player.salary)} · Scrim points ${player.current_scrim_points}`,
    `${eligible ? "✅ Eligible" : "❌ Not eligible"} for week of ${weekStart}${through ? ` · source through ${through}` : ""}`,
  ];
}

function latestTimestamp(values: string[]): string | null {
  let latest: {raw: string; time: number} | null = null;
  for (const raw of values) {
    const time = Date.parse(raw);
    if (!Number.isFinite(time)) continue;
    if (!latest || time > latest.time) latest = {raw, time};
  }
  return latest?.raw ?? null;
}

function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

async function livePlayerRows(env: Env): Promise<{players: LeaguePlayerRow[]; rosteredIds: Set<string>}> {
  const [rostered, prospects] = await Promise.all([
    getRocketLeaguePlayers(env),
    getProspectIdentities(env),
  ]);
  const rows = new Map<string, LeaguePlayerRow>();
  const rosteredIds = new Set<string>();

  for (const player of rostered) {
    rows.set(player.sprocketPlayerId, leaguePlayerFromFranchise(player));
    rosteredIds.add(player.sprocketPlayerId);
  }
  for (const prospect of prospects) {
    if (!rows.has(prospect.sprocketPlayerId)) {
      rows.set(prospect.sprocketPlayerId, leaguePlayerFromProspect(prospect));
    }
  }

  return {players: [...rows.values()], rosteredIds};
}

function resolvePlayerRows(
  players: LeaguePlayerRow[],
  requested: string,
): {player: LeaguePlayerRow | null; suggestions: LeaguePlayerRow[]} {
  const raw = requested.trim();
  const exactId = players.find(player => player.sprocket_player_id === raw);
  if (exactId) return {player: exactId, suggestions: []};

  const needle = normalizeLookup(raw);
  const exactNames = players.filter(player => normalizeLookup(player.name) === needle);
  if (exactNames.length === 1) return {player: exactNames[0], suggestions: []};

  const suggestions = players
    .filter(player =>
      normalizeLookup(player.name).includes(needle) ||
      normalizeLookup(player.sprocket_player_id).includes(needle),
    )
    .slice(0, 5);
  return {player: null, suggestions};
}

async function fetchAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  requestedPlayer: string,
  stats: StatType,
  mode: Mode,
): Promise<void> {
  try {
    const live = await livePlayerRows(env);
    const resolved = resolvePlayerRows(live.players, requestedPlayer);
    const player = resolved.player;
    if (!player) {
      const hint = resolved.suggestions.length > 0
        ? ` Try the autocomplete result for ${resolved.suggestions.map(value => `${value.name} (${value.franchise_name})`).join(", ")}.`
        : "";
      await editOriginalInteraction(interaction, `I couldn't uniquely resolve that player.${hint}`);
      return;
    }

    const rostered = live.rosteredIds.has(player.sprocket_player_id);
    const weekStart = currentLeagueWeekStart();
    const lines = profileLines(player, weekStart, rostered);

    if (rostered && player.slot && teamDivision(player.skill_group)) {
      const sourceUsages = await getFranchiseRoleUsagesForSeason(
        env,
        player.franchise_name,
        CURRENT_MLE_SEASON,
      );
      if (sourceUsages.length === 0) {
        lines.push(`Usage: awaiting S${CURRENT_MLE_SEASON} data.`);
      } else {
        const usages = sourceUsages.map(leagueUsageFromSource);
        const usage = usageForPlayer(player, usages);
        if (usage) {
          const division = teamDivision(player.skill_group)!;
          const remaining = remainingUsage(usage, division);
          lines.push(
            `Current slot usage: 2s ${usage.doubles_uses}/6 (${remaining.doubles} left) · 3s ${usage.standard_uses}/8 (${remaining.standard} left) · total ${usage.total_uses}/12${remaining.combined === 0 ? " · ⛔ exhausted" : ""}`,
          );
        } else {
          lines.push(`Current slot usage: no S${CURRENT_MLE_SEASON} usage recorded for this slot.`);
        }
      }
    }

    lines.push("");
    if (stats === "Game") {
      lines.push(
        `**S${CURRENT_MLE_SEASON} Game Stats**`,
        `Awaiting the S${CURRENT_MLE_SEASON} official player game-stat dataset. Older-season game data is intentionally not used.`,
      );
    } else {
      const sourceStats = await getScoutingStatLines(env);
      const scrimStats = sourceStats
        .filter(stat => stat.sprocketPlayerId === player.sprocket_player_id)
        .map(leagueScrimFromSource);
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

    lines.push("");
    if (player.source_as_of) {
      lines.push(`Profile source as of ${formatEasternTimestamp(player.source_as_of)}.`);
    }
    lines.push("Performance data loaded directly from the current Sprocket publication.");

    await editOriginalInteraction(interaction, lines.join("\n").slice(0, 1950));
  } catch (error) {
    console.error("Player lookup failed", error);
    const detail = safeCommandError(error);
    try {
      await editOriginalInteraction(
        interaction,
        `Hagrid hit an error while building that player profile.\n\n` +
          `Diagnostic: \`${detail || "unknown error"}\``,
      );
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
    // Autocomplete has Discord's short interaction deadline. Keep this path
    // entirely inside D1; live Sprocket fetches happen only after the command
    // has already been deferred.
    const [storedPlayers, cached] = await Promise.all([
      searchLeaguePlayers(env.DB, query, 25),
      getCachedScoutingSnapshot(env),
    ]);

    let players = storedPlayers;
    if (cached) {
      const needle = normalizeLookup(query);
      const currentProspects = cached.identities
        .filter(player =>
          normalizeLookup(player.name).includes(needle) ||
          normalizeLookup(player.sprocketPlayerId).includes(needle),
        )
        .map(leaguePlayerFromProspect);

      const merged = new Map<string, LeaguePlayerRow>();
      for (const prospect of currentProspects) merged.set(prospect.sprocket_player_id, prospect);
      for (const player of storedPlayers) {
        if (player.franchise_name === "FA" || player.franchise_name === "PEND") continue;
        merged.set(player.sprocket_player_id, player);
      }
      players = [...merged.values()]
        .sort((left, right) => left.name.localeCompare(right.name, "en-US", {sensitivity: "base"}))
        .slice(0, 25);
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
