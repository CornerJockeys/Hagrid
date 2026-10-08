import {isEligibleForWeek, currentLeagueWeekStart} from "../eligibility";
import {
  getCurrentLeagueSnapshot,
  snapshotFranchisePlayers,
  snapshotFranchiseRoleUsages,
} from "../league/cache";
import {remainingUsage, slotLabel, teamDivision, type TeamDivision} from "../league/view";
import {getFranchisePlayers} from "../sprocket/players";
import {getFranchiseRoleUsagesForSeason} from "../sprocket/role-usages";
import {CURRENT_MLE_SEASON} from "../season-policy";
import type {Env} from "../types";

export type DumpKind = "eligibility" | "salary" | "usage";
const DIVISIONS: TeamDivision[] = ["FL", "AL", "CL", "ML"];
const DIVISION_NAMES: Record<TeamDivision, string> = {
  FL: "Foundation League",
  AL: "Academy League",
  CL: "Champion League",
  ML: "Master League",
};

function roleKey(value: string | null): string {
  return (value ?? "").trim().replace(/^PLAYER/i, "").toLocaleUpperCase("en-US");
}

function title(franchise: string, matchWeek: number, kind: DumpKind): string {
  const label = kind === "eligibility" ? "Eligibility" : kind === "salary" ? "Salary" : "Usage";
  return `**${franchise} — Match Week ${matchWeek} ${label} Dump**`;
}

function competitive(player: {slot: string | null; skillGroup: string | null}): boolean {
  return Boolean(player.slot && /^PLAYER[A-Z0-9]+$/i.test(player.slot.trim()) && teamDivision(player.skillGroup));
}

export async function buildDumpMessages(
  env: Env,
  franchise: string,
  kind: DumpKind,
  matchWeek: number,
): Promise<string[]> {
  const snapshot = await getCurrentLeagueSnapshot(env);
  const players = (snapshot
    ? snapshotFranchisePlayers(snapshot, franchise)
    : await getFranchisePlayers(env, franchise))
    .filter(competitive)
    .sort((a, b) => {
      const ad = teamDivision(a.skillGroup) ?? "FL";
      const bd = teamDivision(b.skillGroup) ?? "FL";
      return DIVISIONS.indexOf(ad) - DIVISIONS.indexOf(bd) ||
        slotLabel(a.slot).localeCompare(slotLabel(b.slot), "en-US", {numeric: true}) ||
        a.name.localeCompare(b.name);
    });

  const lines = [title(franchise, matchWeek, kind), ""];

  if (kind === "eligibility") {
    const weekStart = currentLeagueWeekStart();
    for (const division of DIVISIONS) {
      const roster = players.filter(player => teamDivision(player.skillGroup) === division);
      if (roster.length === 0) continue;
      lines.push(`**${DIVISION_NAMES[division]}**`);
      for (const player of roster) {
        const status = isEligibleForWeek(player.eligibleThrough, weekStart) ? "✅" : "⚠️";
        lines.push(
          `${status} ${slotLabel(player.slot)} · ${player.name} · ${player.currentScrimPoints} SP · eligible through ${player.eligibleThrough ?? "—"}`,
        );
      }
      lines.push("");
    }
  } else if (kind === "salary") {
    for (const division of DIVISIONS) {
      const roster = players.filter(player => teamDivision(player.skillGroup) === division);
      if (roster.length === 0) continue;
      lines.push(`**${DIVISION_NAMES[division]}**`);
      for (const player of roster) {
        lines.push(`${slotLabel(player.slot)} · ${player.name} · Salary: ${player.salary ?? "—"}`);
      }
      lines.push("");
    }
  } else {
    const usages = snapshot
      ? snapshotFranchiseRoleUsages(snapshot, franchise, CURRENT_MLE_SEASON)
      : await getFranchiseRoleUsagesForSeason(env, franchise, CURRENT_MLE_SEASON);
    for (const division of DIVISIONS) {
      const roster = players.filter(player => teamDivision(player.skillGroup) === division);
      const bySlot = new Map(roster.map(player => [roleKey(player.slot), player]));
      const rows = usages
        .filter(usage => teamDivision(usage.league) === division)
        .sort((a, b) => roleKey(a.role).localeCompare(roleKey(b.role), "en-US", {numeric: true}));
      if (rows.length === 0) continue;
      lines.push(`**${DIVISION_NAMES[division]}**`);
      for (const usage of rows) {
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
        const player = bySlot.get(roleKey(usage.role));
        lines.push(
          `${roleKey(usage.role)} · ${player?.name ?? "Open/unknown slot"} · 2s ${usage.doublesUses}/6 (${remaining.doubles} left) · 3s ${usage.standardUses}/8 (${remaining.standard} left) · total ${usage.totalUses}/12 (${remaining.combined} left)`,
        );
      }
      lines.push("");
    }
  }

  // Discord messages cap at 2000 chars. Split only at line boundaries.
  const messages: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > 1900 && current) {
      messages.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}
