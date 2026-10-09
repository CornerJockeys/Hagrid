export interface AccessRow {
  sprocket_player_id: string;
  name: string;
  skill_group: string | null;
  staff_position: string | null;
  slot: string | null;
}

export interface ActivityAccess {
  rosterMember: boolean;
  staff: boolean;
  captainPlus: boolean;
  agmPlus: boolean;
  playerId: string | null;
  playerName: string | null;
  division: string | null;
  staffPosition: string | null;
  slot: string | null;
}

function textSuggestsStaffRole(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return (
    /(^|\b)(captain|capt)(\b|$)/.test(normalized) ||
    normalized === "agm" ||
    normalized === "gm" ||
    normalized.includes("assistant general manager") ||
    normalized.includes("general manager")
  );
}

function textSuggestsCaptainPlus(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return (
    /(^|\b)(captain|capt)(\b|$)/.test(normalized) ||
    normalized === "agm" ||
    normalized === "gm" ||
    normalized === "fm" ||
    normalized.includes("assistant general manager") ||
    normalized.includes("general manager") ||
    normalized.includes("franchise manager")
  );
}

export function accessFromRosterRows(rows: AccessRow[]): ActivityAccess {
  if (rows.length === 0) {
    return {
      rosterMember: false,
      staff: false,
      captainPlus: false,
      agmPlus: false,
      playerId: null,
      playerName: null,
      division: null,
      staffPosition: null,
      slot: null,
    };
  }

  const preferred =
    rows.find(row => Boolean(row.staff_position?.trim())) ??
    rows.find(row => textSuggestsStaffRole(row.slot)) ??
    rows[0];
  const staffPosition = preferred.staff_position?.trim() || null;

  return {
    rosterMember: true,
    staff: rows.some(row =>
      Boolean(row.staff_position?.trim()) || textSuggestsStaffRole(row.slot),
    ),
    captainPlus: rows.some(row =>
      textSuggestsCaptainPlus(row.staff_position) || textSuggestsCaptainPlus(row.slot),
    ),
    agmPlus: rows.some(row => {
      const value = (row.staff_position ?? row.slot ?? "").trim().toLocaleLowerCase("en-US");
      return value === "agm" || value === "gm" || value === "fm" ||
        value.includes("assistant general manager") ||
        value.includes("general manager") ||
        value.includes("franchise manager");
    }),
    playerId: preferred.sprocket_player_id,
    playerName: preferred.name,
    division: preferred.skill_group?.trim() || null,
    staffPosition,
    slot: preferred.slot?.trim() || null,
  };
}

export function accessFromRosterRow(row: AccessRow | null): ActivityAccess {
  return accessFromRosterRows(row ? [row] : []);
}
