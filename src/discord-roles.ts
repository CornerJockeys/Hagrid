import type {DiscordInteraction, DiscordMember} from "./types";
import type {TeamDivision} from "./league/view";

export const STAFF_ROLE_IDS = {
  FM: "468262078730469386",
  GM: "857328892351610930",
  AGM: "468185329141153792",
  RL_CAPTAIN: "727696641502478338",
} as const;

export const DIVISION_ROLE_IDS: Record<TeamDivision, string> = {
  FL: "1074149871466053722",
  AL: "468184958222204940",
  CL: "468185085087318017",
  ML: "548359826258788353",
};

function roleSet(member: DiscordMember | undefined): Set<string> {
  return new Set(member?.roles ?? []);
}

export function interactionRoleIds(interaction: DiscordInteraction): string[] {
  return interaction.member?.roles ?? [];
}

export function hasAnyStaffRole(interaction: DiscordInteraction): boolean {
  const roles = roleSet(interaction.member);
  return Object.values(STAFF_ROLE_IDS).some(roleId => roles.has(roleId));
}

export function hasAgmPlusRole(interaction: DiscordInteraction): boolean {
  const roles = roleSet(interaction.member);
  return roles.has(STAFF_ROLE_IDS.FM) ||
    roles.has(STAFF_ROLE_IDS.GM) ||
    roles.has(STAFF_ROLE_IDS.AGM);
}

export function hasCaptainRole(interaction: DiscordInteraction): boolean {
  return roleSet(interaction.member).has(STAFF_ROLE_IDS.RL_CAPTAIN);
}

export function captainDivisions(interaction: DiscordInteraction): TeamDivision[] {
  if (!hasCaptainRole(interaction)) return [];
  const roles = roleSet(interaction.member);
  return (Object.entries(DIVISION_ROLE_IDS) as Array<[TeamDivision, string]>)
    .filter(([, roleId]) => roles.has(roleId))
    .map(([division]) => division);
}

export function isCaptainForDivision(
  interaction: DiscordInteraction,
  division: TeamDivision,
): boolean {
  return hasCaptainRole(interaction) && captainDivisions(interaction).includes(division);
}
