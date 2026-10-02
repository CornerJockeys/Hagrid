import type {TeamDivision} from "../league/view";
import type {FranchisePlayer} from "../sprocket/players";
import type {RoleUsage} from "../sprocket/role-usages";

function normalizeDivision(value: string | null): TeamDivision | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "fl" || normalized.includes("foundation")) return "FL";
  if (normalized === "al" || normalized.includes("academy")) return "AL";
  if (normalized === "cl" || normalized.includes("champion")) return "CL";
  if (normalized === "ml" || normalized.includes("master")) return "ML";
  return null;
}

function slotSortLabel(value: string): string {
  return value.trim().replace(/^PLAYER/i, "") || value.trim();
}

function effectiveRemaining(usage: RoleUsage): {doubles: number; standard: number; combined: number} {
  const combined = Math.max(0, 12 - usage.totalUses);
  return {
    doubles: Math.max(0, Math.min(6 - usage.doublesUses, combined)),
    standard: Math.max(0, Math.min(8 - usage.standardUses, combined)),
    combined,
  };
}

export interface UsageAlert {
  slot: string;
  player: FranchisePlayer | null;
  doublesRemaining: number;
  standardRemaining: number;
  combinedRemaining: number;
  text: string;
}

function roleKey(value: string | null): string {
  return (value ?? "").trim().replace(/^PLAYER/i, "").toLocaleUpperCase("en-US");
}

function plural(value: number, singular: string, pluralWord = singular + "s"): string {
  return `${value} ${value === 1 ? singular : pluralWord}`;
}

function sentenceForRemaining(doubles: number, standard: number, combined: number): string | null {
  if (combined === 0) return "has no remaining uses.";

  const lowOverall = combined < 4;
  const lowDoubles = doubles < 3;
  const lowStandard = standard < 3;
  if (!lowOverall && !lowDoubles && !lowStandard) return null;

  const pieces: string[] = [];

  if (lowDoubles) {
    pieces.push(doubles === 0
      ? "has no remaining uses in 2s"
      : `has ${plural(doubles, "remaining use")} in 2s`);
  }

  if (lowStandard) {
    const clause = standard === 0
      ? "no remaining uses in 3s"
      : `${plural(standard, "use")} left in 3s`;
    pieces.push(pieces.length === 0 ? `has ${clause}` : clause);
  }

  // Overall is most useful when it adds information that the mode warnings do
  // not already fully express. If both modes are already low, the combined
  // remainder is redundant (for example: 0 left in 2s and 2 left in 3s).
  if (lowOverall && !(lowDoubles && lowStandard)) {
    const clause = `${plural(combined, "use")} overall`;
    pieces.push(pieces.length === 0 ? `has ${clause}` : clause);
  }

  if (pieces.length === 1) return pieces[0] + ".";

  if (pieces[0].startsWith("has ")) {
    const [first, ...rest] = pieces;
    return `${first}. ${rest.map(value => value.charAt(0).toUpperCase() + value.slice(1)).join(". ")}.`;
  }

  return pieces.join(". ") + ".";
}

export function buildUsageAlerts(
  division: TeamDivision,
  players: FranchisePlayer[],
  usages: RoleUsage[],
): UsageAlert[] {
  const roster = players.filter(player =>
    player.slot &&
    /^PLAYER[A-Z0-9]+$/i.test(player.slot.trim()) &&
    normalizeDivision(player.skillGroup) === division,
  );

  const bySlot = new Map(roster.map(player => [roleKey(player.slot), player]));

  return usages
    .filter(usage => normalizeDivision(usage.league) === division)
    .map(usage => {
      const slot = roleKey(usage.role);
      const remaining = effectiveRemaining(usage);
      const text = sentenceForRemaining(remaining.doubles, remaining.standard, remaining.combined);
      return {
        slot,
        player: bySlot.get(slot) ?? null,
        doublesRemaining: remaining.doubles,
        standardRemaining: remaining.standard,
        combinedRemaining: remaining.combined,
        text,
      };
    })
    .filter((value): value is UsageAlert => Boolean(value.text))
    .sort((a, b) => slotSortLabel(a.slot).localeCompare(slotSortLabel(b.slot), "en-US", {numeric: true}));
}
