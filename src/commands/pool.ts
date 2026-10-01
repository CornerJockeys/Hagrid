import {
  discordDeferred,
  discordMessage,
  discordUpdateMessage,
  editOriginalInteraction,
} from "../discord";
import type {LeagueCode, ProspectStatus} from "../scouting/calculate";
import {ensureScoutingSnapshot} from "../scouting/refresh";
import {getPoolPlayers, type PoolPlayer} from "../scouting/query";
import type {DiscordInteraction, Env, ExecutionContextLike} from "../types";

const DIVISIONS = new Set<LeagueCode>(["FL", "AL", "CL", "ML", "PL"]);
const STATUSES = new Set<ProspectStatus>(["FA", "PEND"]);
const MAX_PAGE_LENGTH = 1850;

type FaStatusFilter = ProspectStatus | "BOTH";

function optionValue(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function numberOptionValue(interaction: DiscordInteraction, name: string): number | null {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatSalary(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function statusLabel(status: FaStatusFilter): string {
  if (status === "BOTH") return "FA + PEND";
  return status;
}

function section(status: ProspectStatus, players: PoolPlayer[]): string[] {
  const matching = players.filter(player => player.status === status);
  if (matching.length === 0) return [];
  return [
    `**${status} (${matching.length})**`,
    ...matching.map(player => `• ${player.name} — ${formatSalary(player.salary)}`),
  ];
}

function renderPage(
  division: LeagueCode,
  requestedStatus: FaStatusFilter,
  salary: number | null,
  pagePlayers: PoolPlayer[],
  totalPlayers: number,
  pageIndex: number,
  pageCount: number,
): string {
  const label = statusLabel(requestedStatus);
  const lines = [
    `**${division} ${label} — ${totalPlayers} player${totalPlayers === 1 ? "" : "s"}**`,
  ];
  if (salary !== null) lines.push(`Salary: **${formatSalary(salary)}**`);
  lines.push("");

  if (totalPlayers === 0) {
    lines.push(`No ${label} players are currently listed in ${division}${salary === null ? "" : ` at salary ${formatSalary(salary)}`}.`);
    return lines.join("\n");
  }

  if (requestedStatus === "BOTH") {
    const fa = section("FA", pagePlayers);
    const pending = section("PEND", pagePlayers);
    if (fa.length > 0) lines.push(...fa);
    if (fa.length > 0 && pending.length > 0) lines.push("");
    if (pending.length > 0) lines.push(...pending);
  } else {
    lines.push(...section(requestedStatus, pagePlayers));
  }

  if (pageCount > 1) lines.push("", `Page **${pageIndex + 1}/${pageCount}**`);
  return lines.join("\n");
}

export function buildFaPages(
  division: LeagueCode,
  requestedStatus: FaStatusFilter,
  salary: number | null,
  players: PoolPlayer[],
): string[] {
  if (players.length === 0) {
    return [renderPage(division, requestedStatus, salary, [], 0, 0, 1)];
  }

  const chunks: PoolPlayer[][] = [];
  let current: PoolPlayer[] = [];

  for (const player of players) {
    const candidate = [...current, player];
    const candidateText = renderPage(
      division,
      requestedStatus,
      salary,
      candidate,
      players.length,
      998,
      999,
    );

    if (current.length > 0 && candidateText.length > MAX_PAGE_LENGTH) {
      chunks.push(current);
      current = [player];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunk, index) =>
    renderPage(division, requestedStatus, salary, chunk, players.length, index, chunks.length));
}

function faCustomId(
  division: LeagueCode,
  status: FaStatusFilter,
  salary: number | null,
  pageIndex: number,
): string {
  return `fa:${division}:${status}:${salary === null ? "*" : salary}:${pageIndex}`;
}

export function parseFaCustomId(customId: string): {
  division: LeagueCode;
  status: FaStatusFilter;
  salary: number | null;
  pageIndex: number;
} | null {
  const [prefix, divisionRaw, statusRaw, salaryRaw, pageRaw, ...extra] = customId.split(":");
  if (prefix !== "fa" || extra.length > 0 || !DIVISIONS.has(divisionRaw as LeagueCode)) return null;
  if (statusRaw !== "BOTH" && !STATUSES.has(statusRaw as ProspectStatus)) return null;

  const salary = salaryRaw === "*" ? null : Number(salaryRaw);
  const pageIndex = Number(pageRaw);
  if ((salary !== null && (!Number.isFinite(salary) || salary < 0 || salary > 100)) ||
      !Number.isInteger(pageIndex) || pageIndex < 0) {
    return null;
  }

  return {
    division: divisionRaw as LeagueCode,
    status: statusRaw as FaStatusFilter,
    salary,
    pageIndex,
  };
}

function pageComponents(
  division: LeagueCode,
  status: FaStatusFilter,
  salary: number | null,
  pageIndex: number,
  pageCount: number,
): unknown[] {
  if (pageCount <= 1) return [];
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: "Previous",
        custom_id: faCustomId(division, status, salary, Math.max(0, pageIndex - 1)),
        disabled: pageIndex <= 0,
      },
      {
        type: 2,
        style: 2,
        label: "Next",
        custom_id: faCustomId(division, status, salary, Math.min(pageCount - 1, pageIndex + 1)),
        disabled: pageIndex >= pageCount - 1,
      },
    ],
  }];
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
      pageComponents(division, status, salary, 0, pages.length),
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
  return discordDeferred();
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
      pageComponents(parsed.division, parsed.status, parsed.salary, pageIndex, pages.length),
    );
  } catch (error) {
    console.error("FA pagination failed", error);
    return discordUpdateMessage("I could not load that FA page. Please run `/fa` again.");
  }
}
