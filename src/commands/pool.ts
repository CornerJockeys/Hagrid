import {
  discordDeferred,
  discordMessage,
  discordUpdateMessage,
  editOriginalInteraction,
} from "../discord";
import type {LeagueCode, ProspectStatus} from "../scouting/calculate";
import {ensureScoutingSnapshot} from "../scouting/refresh";
import {getPoolPlayers} from "../scouting/query";
import type {DiscordInteraction, Env, ExecutionContextLike} from "../types";
import {
  buildFaPages,
  faPageComponents,
  parseFaCustomId,
  type FaStatusFilter,
} from "./fa-format";

const DIVISIONS = new Set<LeagueCode>(["FL", "AL", "CL", "ML", "PL"]);
const STATUSES = new Set<ProspectStatus>(["FA", "PEND"]);

function optionValue(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function numberOptionValue(interaction: DiscordInteraction, name: string): number | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  division: LeagueCode,
  status: FaStatusFilter,
  salary: number | null,
): Promise<void> {
  try {
    await ensureScoutingSnapshot(env);
    const players = await getPoolPlayers(env, division, status === "BOTH" ? null : status, salary);
    const pages = buildFaPages(division, status, salary, players);
    await editOriginalInteraction(
      interaction,
      pages[0],
      faPageComponents(division, status, salary, 0, pages.length),
    );
  } catch (error) {
    console.error("FA lookup failed", error);
    try {
      await editOriginalInteraction(
        interaction,
        "I could not refresh or read the current FA/PEND pool. Please try again after the next scouting refresh.",
      );
    } catch (responseError) {
      console.error("Failed to report FA lookup error to Discord", responseError);
    }
  }
}

export async function handleFaCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!interaction.guild_id) {
    return discordMessage("The FA command can only be used inside a Discord server.");
  }

  const divisionRaw = optionValue(interaction, "division")?.toLocaleUpperCase("en-US") ?? "";
  const statusRaw = optionValue(interaction, "status")?.toLocaleUpperCase("en-US") ?? "BOTH";
  const salary = numberOptionValue(interaction, "salary");

  if (!DIVISIONS.has(divisionRaw as LeagueCode)) {
    return discordMessage("Choose a division: FL, AL, CL, ML, or PL.");
  }
  if (statusRaw !== "BOTH" && !STATUSES.has(statusRaw as ProspectStatus)) {
    return discordMessage("Status must be FA, PEND, or BOTH.");
  }
  if (salary !== null && (salary < 0 || salary > 100)) {
    return discordMessage("Salary must be between 0 and 100.");
  }

  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  const division = divisionRaw as LeagueCode;
  const status = statusRaw as FaStatusFilter;
  ctx.waitUntil(fetchAndRespond(interaction, env, division, status, salary));
  return discordDeferred(false);
}

export async function handleFaComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const parsed = parseFaCustomId(interaction.data?.custom_id ?? "");
  if (!parsed) return discordMessage("That FA page control is no longer valid. Please run `/fa` again.");

  try {
    const players = await getPoolPlayers(
      env,
      parsed.division,
      parsed.status === "BOTH" ? null : parsed.status,
      parsed.salary,
    );
    const pages = buildFaPages(parsed.division, parsed.status, parsed.salary, players);
    const pageIndex = Math.min(parsed.pageIndex, pages.length - 1);
    return discordUpdateMessage(
      pages[pageIndex],
      faPageComponents(parsed.division, parsed.status, parsed.salary, pageIndex, pages.length),
    );
  } catch (error) {
    console.error("FA pagination failed", error);
    return discordUpdateMessage("I could not load that FA page. Please run `/fa` again.");
  }
}
