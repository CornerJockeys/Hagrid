import {getCachedGuildConfig} from "../config-cache";
import {discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {CURRENT_MLE_SEASON} from "../season-policy";
import {DatasetFetchError} from "../sprocket/client";
import {sameText} from "../sprocket/fields";
import {getSeasonStandings, type StandingRow} from "../sprocket/standings";
import type {
  DiscordCommandOption,
  DiscordInteraction,
  Env,
  ExecutionContextLike,
} from "../types";

interface LeagueChoice {
  short: "FL" | "AL" | "CL" | "ML";
  name: string;
}

const LEAGUES: LeagueChoice[] = [
  {short: "FL", name: "Foundation League"},
  {short: "AL", name: "Academy League"},
  {short: "CL", name: "Champion League"},
  {short: "ML", name: "Master League"},
];

const MODES = ["Overall", "Doubles", "Standard"] as const;
type ModeChoice = typeof MODES[number];

function optionValue(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function leagueChoice(raw: string | null): LeagueChoice | null {
  if (!raw) return null;
  return LEAGUES.find(choice => choice.name === raw || choice.short === raw.toUpperCase()) ?? null;
}

function modeChoice(raw: string | null): ModeChoice | null {
  if (!raw) return "Overall";
  return MODES.find(mode => mode === raw) ?? null;
}

function selectedMode(mode: ModeChoice): string | null {
  return mode === "Overall" ? null : mode;
}

function isPrimaryStanding(row: StandingRow): boolean {
  return row.divisionName !== null && row.conference !== null && row.league !== null;
}

function findFranchiseRow(
  rows: StandingRow[],
  franchiseName: string,
  leagueName: string,
  mode: ModeChoice,
): StandingRow | null {
  const targetMode = selectedMode(mode);
  return rows.find(row =>
    isPrimaryStanding(row) &&
    sameText(row.name, franchiseName) &&
    sameText(row.league, leagueName) &&
    (targetMode === null ? row.mode === null : sameText(row.mode, targetMode)),
  ) ?? null;
}

function relevantTable(rows: StandingRow[], franchiseRow: StandingRow): StandingRow[] {
  return rows
    .filter(row =>
      isPrimaryStanding(row) &&
      row.season === franchiseRow.season &&
      sameText(row.divisionName, franchiseRow.divisionName) &&
      sameText(row.conference, franchiseRow.conference) &&
      sameText(row.league, franchiseRow.league) &&
      ((row.mode === null && franchiseRow.mode === null) || sameText(row.mode, franchiseRow.mode)),
    )
    .sort((left, right) => left.ranking - right.ranking || left.name.localeCompare(right.name));
}

function record(row: StandingRow): string {
  const total = row.teamWins + row.teamLosses;
  const pct = total > 0 ? ((row.teamWins / total) * 100).toFixed(1) : "0.0";
  return `${row.teamWins}-${row.teamLosses} (${pct}%)`;
}

function formatLeagueTable(
  rows: StandingRow[],
  franchiseName: string,
  league: LeagueChoice,
  mode: ModeChoice,
): string {
  const franchiseRow = findFranchiseRow(rows, franchiseName, league.name, mode);
  if (!franchiseRow) {
    return `No S${CURRENT_MLE_SEASON} ${league.short} ${mode.toLowerCase()} standings were found for ${franchiseName}.`;
  }

  const peers = relevantTable(rows, franchiseRow);
  const headingMode = mode === "Overall" ? "Overall" : mode;
  const context = [franchiseRow.divisionName, franchiseRow.conference]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  const lines = peers.map(row => {
    const label = `${row.ranking}. ${row.name} — ${record(row)}`;
    return sameText(row.name, franchiseName) ? `**${label}**` : label;
  });

  return [
    `**${league.short} ${headingMode} — ${franchiseRow.season}**`,
    context,
    "",
    ...lines,
  ].filter((line, index) => line !== "" || index === 2).join("\n");
}

function formatOverview(
  rows: StandingRow[],
  franchiseName: string,
  mode: ModeChoice,
): string {
  const franchiseRows = LEAGUES
    .map(league => ({league, row: findFranchiseRow(rows, franchiseName, league.name, mode)}))
    .filter((entry): entry is {league: LeagueChoice; row: StandingRow} => entry.row !== null);

  if (franchiseRows.length === 0) {
    return `No S${CURRENT_MLE_SEASON} ${mode.toLowerCase()} standings were found for ${franchiseName}.`;
  }

  const season = franchiseRows[0].row.season;
  const headingMode = mode === "Overall" ? "Overall" : mode;
  const lines = franchiseRows.map(({league, row}) =>
    `**${league.short}** — #${row.ranking} · ${record(row)} · ${row.divisionName ?? "Unknown division"}`,
  );

  return [
    `**${franchiseName} — ${headingMode} Standings (${season})**`,
    ...lines,
    "",
    "Use `/standings league:<league>` to show the full relevant division table.",
  ].join("\n");
}

async function fetchAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  franchiseName: string,
  league: LeagueChoice | null,
  mode: ModeChoice,
): Promise<void> {
  try {
    const rows = await getSeasonStandings(env, CURRENT_MLE_SEASON);
    const content = rows.length === 0
      ? `S${CURRENT_MLE_SEASON} standings are not available in the Sprocket dataset yet.`
      : league
        ? formatLeagueTable(rows, franchiseName, league, mode)
        : formatOverview(rows, franchiseName, mode);
    await editOriginalInteraction(interaction, content.slice(0, 1900));
  } catch (error) {
    console.error("Standings lookup failed", error);
    const message = error instanceof DatasetFetchError
      ? "I could not reach or parse the current Sprocket standings dataset."
      : "Hagrid hit an error while building the standings response.";

    try {
      await editOriginalInteraction(interaction, message);
    } catch (responseError) {
      console.error("Failed to report standings error to Discord", responseError);
    }
  }
}

export async function handleStandingsCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return discordMessage("Standings can only be used inside a Discord server.");
  }

  const config = await getCachedGuildConfig(env, guildId);
  if (!config) {
    return discordMessage("Set Hagrid's franchise with `/franchise set` before using standings.");
  }

  const rawLeague = optionValue(interaction, "league");
  const rawMode = optionValue(interaction, "mode");
  const league = leagueChoice(rawLeague);
  const mode = modeChoice(rawMode);

  if (rawLeague && !league) {
    return discordMessage("Unknown league selection.");
  }

  if (!mode) {
    return discordMessage("Unknown standings mode.");
  }

  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  ctx.waitUntil(fetchAndRespond(interaction, env, config.franchise_name, league, mode));
  return discordDeferred();
}
