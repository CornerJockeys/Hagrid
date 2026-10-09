import {teamDivision, type TeamDivision} from "../league/view";
import type {LeagueUsageRow} from "../league/db";
import type {RoleUsage} from "../sprocket/role-usages";
import type {D1Database} from "../types";

interface NcpRecordRow {
  division: string;
  mode: string;
  slots_json: string;
}

interface NcpUsageAdjustment {
  division: TeamDivision;
  slot: string;
  doubles: number;
  standard: number;
  total: number;
}

function roleKey(value: string | null): string {
  return (value ?? "").trim().replace(/^PLAYER/i, "").toLocaleUpperCase("en-US");
}

function division(value: string): TeamDivision | null {
  const normalized = value.trim().toLocaleUpperCase("en-US");
  return normalized === "FL" || normalized === "AL" || normalized === "CL" || normalized === "ML"
    ? normalized
    : null;
}

export async function getNcpUsageAdjustments(
  db: D1Database,
  franchiseName: string,
  seasonNumber: number,
): Promise<NcpUsageAdjustment[]> {
  const result = await db.prepare(
    `SELECT division, mode, slots_json
     FROM ncp_records
     WHERE LOWER(franchise_name) = LOWER(?)
       AND season_number = ?
       AND status = 'approved'
     ORDER BY id`,
  ).bind(franchiseName, seasonNumber).all<NcpRecordRow>();

  const byKey = new Map<string, NcpUsageAdjustment>();
  for (const row of result.results) {
    const div = division(row.division);
    if (!div || (row.mode !== "2s" && row.mode !== "3s")) continue;
    let slots: unknown;
    try { slots = JSON.parse(row.slots_json); } catch { continue; }
    if (!Array.isArray(slots)) continue;
    for (const raw of slots) {
      if (typeof raw !== "string") continue;
      const slot = roleKey(raw);
      if (!slot) continue;
      const key = `${div}|${slot}`;
      const current = byKey.get(key) ?? {division: div, slot, doubles: 0, standard: 0, total: 0};
      if (row.mode === "2s") current.doubles += 1;
      else current.standard += 1;
      current.total += 1;
      byKey.set(key, current);
    }
  }
  return [...byKey.values()];
}

export async function applyNcpToLeagueUsage(
  db: D1Database,
  franchiseName: string,
  seasonNumber: number,
  base: LeagueUsageRow[],
): Promise<LeagueUsageRow[]> {
  const adjustments = await getNcpUsageAdjustments(db, franchiseName, seasonNumber);
  const rows = base.map(row => ({...row}));
  for (const adjustment of adjustments) {
    let row = rows.find(value =>
      value.season_number === seasonNumber &&
      teamDivision(value.league) === adjustment.division &&
      roleKey(value.role) === adjustment.slot
    );
    if (!row) {
      row = {
        team_name: franchiseName,
        season_number: seasonNumber,
        league: adjustment.division,
        role: adjustment.slot,
        doubles_uses: 0,
        standard_uses: 0,
        total_uses: 0,
        source_as_of: null,
        refreshed_at: "",
      };
      rows.push(row);
    }
    row.doubles_uses += adjustment.doubles;
    row.standard_uses += adjustment.standard;
    row.total_uses += adjustment.total;
  }
  return rows;
}

export async function applyNcpToRoleUsage(
  db: D1Database,
  franchiseName: string,
  seasonNumber: number,
  base: RoleUsage[],
): Promise<RoleUsage[]> {
  const adjustments = await getNcpUsageAdjustments(db, franchiseName, seasonNumber);
  const rows = base.map(row => ({...row}));
  for (const adjustment of adjustments) {
    let row = rows.find(value =>
      value.seasonNumber === seasonNumber &&
      teamDivision(value.league) === adjustment.division &&
      roleKey(value.role) === adjustment.slot
    );
    if (!row) {
      row = {
        doublesUses: 0,
        standardUses: 0,
        totalUses: 0,
        seasonNumber,
        teamName: franchiseName,
        league: adjustment.division,
        role: adjustment.slot,
        sourceAsOf: null,
      };
      rows.push(row);
    }
    row.doublesUses += adjustment.doubles;
    row.standardUses += adjustment.standard;
    row.totalUses += adjustment.total;
  }
  return rows;
}
