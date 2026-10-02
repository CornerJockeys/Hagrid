import type {LeaguePlayerRow, LeagueUsageRow} from "./db";

export type TeamDivision = "FL" | "AL" | "CL" | "ML";

const DIVISION_ORDER: TeamDivision[] = ["ML", "CL", "AL", "FL"];

export interface UsagePolicy {
  rosterSlots: number;
  doublesLimit: number;
  standardLimit: number;
  combinedLimit: number;
}

export interface UsageRemaining {
  doubles: number;
  standard: number;
  combined: number;
}

export function usagePolicyForDivision(division: TeamDivision): UsagePolicy {
  return {
    rosterSlots: division === "FL" ? 7 : 8,
    doublesLimit: 6,
    standardLimit: 8,
    combinedLimit: 12,
  };
}

export function remainingUsage(
  usage: LeagueUsageRow,
  division: TeamDivision,
): UsageRemaining {
  const policy = usagePolicyForDivision(division);
  const combined = Math.max(0, policy.combinedLimit - usage.total_uses);
  return {
    doubles: Math.max(0, Math.min(policy.doublesLimit - usage.doubles_uses, combined)),
    standard: Math.max(0, Math.min(policy.standardLimit - usage.standard_uses, combined)),
    combined,
  };
}

export function teamDivision(value: string | null): TeamDivision | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "fl" || normalized.includes("foundation")) return "FL";
  if (normalized === "al" || normalized.includes("academy")) return "AL";
  if (normalized === "cl" || normalized.includes("champion")) return "CL";
  if (normalized === "ml" || normalized.includes("master")) return "ML";
  return null;
}

export function teamDivisionOrder(value: TeamDivision): number {
  return DIVISION_ORDER.indexOf(value);
}

export function isCompetitiveSlot(value: string | null): boolean {
  return Boolean(value && /^PLAYER[A-Z0-9]+$/i.test(value.trim()));
}

export function slotLabel(value: string | null): string {
  if (!value) return "—";
  return value.trim().replace(/^PLAYER/i, "") || value.trim();
}

export function formatSalary(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function usageRoleKey(value: string): string {
  return value.trim().replace(/^PLAYER/i, "").toLocaleUpperCase("en-US");
}

export function usageForPlayer(
  player: LeaguePlayerRow,
  usages: LeagueUsageRow[],
): LeagueUsageRow | null {
  const division = teamDivision(player.skill_group);
  if (!division || !player.slot) return null;
  const slot = usageRoleKey(player.slot);
  return usages.find(usage =>
    teamDivision(usage.league) === division && usageRoleKey(usage.role) === slot,
  ) ?? null;
}

export function formatEasternTimestamp(value: string | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(parsed);
}
