import {remainingUsage, slotLabel, teamDivision, type TeamDivision} from "../league/view.ts";
import type {FranchisePlayer} from "../sprocket/players";
import type {RoleUsage} from "../sprocket/role-usages";

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
    teamDivision(player.skillGroup) === division,
  );

  const bySlot = new Map(roster.map(player => [roleKey(player.slot), player]));

  return usages
    .filter(usage => teamDivision(usage.league) === division)
    .map(usage => {
      const slot = roleKey(usage.role);
      const remaining = remainingUsage({
        team_name: usage.teamName,
        season_number: usage.seasonNumber,
        league: usage.league,
        role: usage.role,
        doubles_uses: usage.doublesUses,
        standard_uses: usage.standardUses,
        total_uses: usage.totalUses,
        source_as_of: usage.sourceAsOf,
        refreshed_at: "",
      }, division);
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
    .sort((a, b) => slotLabel(a.slot).localeCompare(slotLabel(b.slot), "en-US", {numeric: true}));
}
