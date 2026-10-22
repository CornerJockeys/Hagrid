import {isCompetitiveSlot, teamDivision, type TeamDivision} from "./league/view.ts";

export interface RosterRoleTarget {
  sprocketPlayerId: string;
  discordUserId: string;
  division: TeamDivision | null;
  captain: boolean;
}

export function isCaptainPosition(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return /(^|\b)(captain|capt)(\b|$)/.test(normalized);
}

export function isFranchiseStaffPosition(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return (
    normalized === "agm" ||
    normalized === "gm" ||
    normalized === "fm" ||
    normalized.includes("assistant general manager") ||
    normalized.includes("general manager") ||
    normalized.includes("franchise manager")
  );
}

export function rosterRoleTarget(player: {
  sprocket_player_id: string;
  discord_id: string | null;
  skill_group: string | null;
  staff_position: string | null;
  slot: string | null;
}): RosterRoleTarget | null {
  const discordUserId = player.discord_id?.trim() ?? "";
  if (!/^\d{10,25}$/.test(discordUserId)) return null;

  const competitive = isCompetitiveSlot(player.slot);
  const division = competitive ? teamDivision(player.skill_group) : null;

  return {
    sprocketPlayerId: player.sprocket_player_id,
    discordUserId,
    division,
    captain: competitive && isCaptainPosition(player.staff_position),
  };
}


export interface FormerRoleFlags {
  formerPlayer: boolean;
  formerFranchiseStaff: boolean;
}

export function formerRoleFlags(input: {
  wasPlayer: boolean;
  wasFranchiseStaff: boolean;
  currentKnown: boolean;
  currentSameFranchise: boolean;
  currentCompetitive: boolean;
  currentFranchiseStaff: boolean;
}): FormerRoleFlags {
  const currentPlayer = input.currentSameFranchise && input.currentCompetitive;
  const currentStaff = input.currentSameFranchise && input.currentFranchiseStaff;

  return {
    formerPlayer: input.wasPlayer && !currentPlayer,
    // A missing player-feed row can mean someone became non-playing staff.
    // Require positive current data before calling them former franchise staff.
    formerFranchiseStaff:
      input.wasFranchiseStaff &&
      input.currentKnown &&
      !currentStaff,
  };
}
