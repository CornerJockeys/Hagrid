export type FaDivision = "FL" | "AL" | "CL" | "ML" | "PL";
export type FaPlayerStatus = "FA" | "PEND";
export type FaStatusFilter = FaPlayerStatus | "BOTH";

export interface FaPlayer {
  name: string;
  salary: number | null;
  status: FaPlayerStatus;
}

const DIVISIONS = new Set<FaDivision>(["FL", "AL", "CL", "ML", "PL"]);
const STATUSES = new Set<FaPlayerStatus>(["FA", "PEND"]);
const MAX_PAGE_LENGTH = 1850;

function formatSalary(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function statusLabel(status: FaStatusFilter): string {
  if (status === "BOTH") return "FA + PEND";
  return status;
}

function section(status: FaPlayerStatus, players: FaPlayer[]): string[] {
  const matching = players.filter(player => player.status === status);
  if (matching.length === 0) return [];
  return [
    `**${status} (${matching.length})**`,
    ...matching.map(player => `• ${player.name} — ${formatSalary(player.salary)}`),
  ];
}

function renderPage(
  division: FaDivision,
  requestedStatus: FaStatusFilter,
  salary: number | null,
  pagePlayers: FaPlayer[],
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
  division: FaDivision,
  requestedStatus: FaStatusFilter,
  salary: number | null,
  players: FaPlayer[],
): string[] {
  if (players.length === 0) {
    return [renderPage(division, requestedStatus, salary, [], 0, 0, 1)];
  }

  const chunks: FaPlayer[][] = [];
  let current: FaPlayer[] = [];

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

export function faCustomId(
  division: FaDivision,
  status: FaStatusFilter,
  salary: number | null,
  pageIndex: number,
): string {
  return `fa:${division}:${status}:${salary === null ? "*" : salary}:${pageIndex}`;
}

export function parseFaCustomId(customId: string): {
  division: FaDivision;
  status: FaStatusFilter;
  salary: number | null;
  pageIndex: number;
} | null {
  const [prefix, divisionRaw, statusRaw, salaryRaw, pageRaw, ...extra] = customId.split(":");
  if (prefix !== "fa" || extra.length > 0 || !DIVISIONS.has(divisionRaw as FaDivision)) return null;
  if (statusRaw !== "BOTH" && !STATUSES.has(statusRaw as FaPlayerStatus)) return null;

  const salary = salaryRaw === "*" ? null : Number(salaryRaw);
  const pageIndex = Number(pageRaw);
  if ((salary !== null && (!Number.isFinite(salary) || salary < 0 || salary > 100)) ||
      !Number.isInteger(pageIndex) || pageIndex < 0) {
    return null;
  }

  return {
    division: divisionRaw as FaDivision,
    status: statusRaw as FaStatusFilter,
    salary,
    pageIndex,
  };
}

export function faPageComponents(
  division: FaDivision,
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
