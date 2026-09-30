import {discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import type {LeagueCode, ProspectStatus} from "../scouting/calculate";
import {ensureScoutingSnapshot} from "../scouting/refresh";
import {getPoolPlayers, type PoolPlayer} from "../scouting/query";
import type {DiscordInteraction, Env, ExecutionContextLike} from "../types";

const DIVISIONS = new Set<LeagueCode>(["FL", "AL", "CL", "ML", "PL"]);
const STATUSES = new Set<ProspectStatus>(["FA", "PEND"]);

function optionValue(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function formatSalary(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function section(status: ProspectStatus, players: PoolPlayer[]): string[] {
  const matching = players.filter(player => player.status === status);
  if (matching.length === 0) return [];
  return [
    `**${status} (${matching.length})**`,
    ...matching.map(player => `• ${player.name} — ${formatSalary(player.salary)}`),
  ];
}

function fitDiscord(lines: string[], totalPlayers: number): string {
  const maximum = 1900;
  const output: string[] = [];
  let shown = 0;

  for (const line of lines) {
    const candidate = [...output, line].join("\n");
    if (candidate.length > maximum - 70) break;
    output.push(line);
    if (line.startsWith("• ")) shown += 1;
  }

  const hidden = Math.max(0, totalPlayers - shown);
  if (hidden > 0) output.push(`\n… +${hidden} more player${hidden === 1 ? "" : "s"}.`);
  return output.join("\n");
}

function formatPool(
  division: LeagueCode,
  requestedStatus: ProspectStatus | null,
  players: PoolPlayer[],
): string {
  const label = requestedStatus ?? "FA/PEND";
  const lines = [`**${division} ${label} Pool — ${players.length} player${players.length === 1 ? "" : "s"}**`, ""];

  if (players.length === 0) {
    lines.push(`No ${label} players are currently listed in ${division}.`);
    return lines.join("\n");
  }

  if (requestedStatus) {
    lines.push(...section(requestedStatus, players));
  } else {
    const fa = section("FA", players);
    const pending = section("PEND", players);
    if (fa.length > 0) lines.push(...fa);
    if (fa.length > 0 && pending.length > 0) lines.push("");
    if (pending.length > 0) lines.push(...pending);
  }

  return fitDiscord(lines, players.length);
}

async function fetchAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  division: LeagueCode,
  status: ProspectStatus | null,
): Promise<void> {
  try {
    await ensureScoutingSnapshot(env);
    const players = await getPoolPlayers(env, division, status);
    await editOriginalInteraction(interaction, formatPool(division, status, players));
  } catch (error) {
    console.error("Pool lookup failed", error);
    try {
      await editOriginalInteraction(
        interaction,
        "I could not refresh or read the current FA/PEND pool. Please try again after the next scouting refresh.",
      );
    } catch (responseError) {
      console.error("Failed to report pool error to Discord", responseError);
    }
  }
}

export async function handlePoolCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!interaction.guild_id) {
    return discordMessage("The pool command can only be used inside a Discord server.");
  }

  const divisionRaw = optionValue(interaction, "division")?.toLocaleUpperCase("en-US") ?? "";
  const statusRaw = optionValue(interaction, "status")?.toLocaleUpperCase("en-US") ?? "";
  if (!DIVISIONS.has(divisionRaw as LeagueCode)) {
    return discordMessage("Choose a division: FL, AL, CL, ML, or PL.");
  }
  if (statusRaw && !STATUSES.has(statusRaw as ProspectStatus)) {
    return discordMessage("Status must be FA or PEND.");
  }

  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  const division = divisionRaw as LeagueCode;
  const status = statusRaw ? statusRaw as ProspectStatus : null;
  ctx.waitUntil(fetchAndRespond(interaction, env, division, status));
  return discordDeferred();
}
