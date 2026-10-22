import {DIVISION_ROLE_IDS} from "./discord-roles.ts";
import {isCompetitiveSlot, teamDivision} from "./league/view.ts";

export interface RosterRoleTarget {
  sprocketPlayerId: string;
  discordUserId: string;
  divisionRoleId: string | null;
  captain: boolean;
}

export function isCaptainPosition(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return /(^|\b)(captain|capt)(\b|$)/.test(normalized);
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
    divisionRoleId: division ? DIVISION_ROLE_IDS[division] : null,
    captain: competitive && isCaptainPosition(player.staff_position),
  };
}
