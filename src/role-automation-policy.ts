import {DIVISION_ROLE_IDS, STAFF_ROLE_IDS} from "./discord-roles.ts";

export const ROLE_AUTOMATION_CIRCUMSTANCES = [
  "new_member",
  "FL",
  "AL",
  "CL",
  "ML",
  "captain",
  "former_player",
  "former_franchise_staff",
] as const;

export type RoleAutomationCircumstance =
  typeof ROLE_AUTOMATION_CIRCUMSTANCES[number];

export type RoleAutomationConfig = Record<RoleAutomationCircumstance, string[]>;

export const DEFAULT_ROLE_AUTOMATION_CONFIG: RoleAutomationConfig = {
  new_member: ["490569480473149453"],
  FL: [DIVISION_ROLE_IDS.FL],
  AL: [DIVISION_ROLE_IDS.AL],
  CL: [DIVISION_ROLE_IDS.CL],
  ML: [DIVISION_ROLE_IDS.ML],
  captain: [STAFF_ROLE_IDS.RL_CAPTAIN],
  former_player: [],
  former_franchise_staff: [],
};

const PROTECTED_ADMIN_ROLE_IDS = new Set<string>([
  STAFF_ROLE_IDS.AGM,
  STAFF_ROLE_IDS.GM,
  STAFF_ROLE_IDS.FM,
]);

export function parseRoleIdList(value: unknown): string[] {
  if (typeof value !== "string") {
    throw new Error("Role mappings must be comma-separated text.");
  }

  const roles = value
    .split(",")
    .map(role => role.trim())
    .filter(Boolean);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const roleId of roles) {
    if (!/^\d{10,25}$/.test(roleId)) {
      throw new Error(
        `"${roleId}" is not a valid Discord role ID. Use numeric role IDs separated by commas.`,
      );
    }
    if (PROTECTED_ADMIN_ROLE_IDS.has(roleId)) {
      throw new Error(
        "AGM, GM, and FM roles are protected and cannot be assigned by Hagrid automation.",
      );
    }
    if (!seen.has(roleId)) {
      seen.add(roleId);
      unique.push(roleId);
    }
  }

  if (unique.length > 10) {
    throw new Error("A single circumstance can assign at most 10 Discord roles.");
  }

  return unique;
}

export function parseRoleAutomationPayload(
  value: unknown,
): RoleAutomationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Role automation mappings are missing.");
  }

  const record = value as Record<string, unknown>;
  return {
    new_member: parseRoleIdList(record.new_member ?? ""),
    FL: parseRoleIdList(record.FL ?? ""),
    AL: parseRoleIdList(record.AL ?? ""),
    CL: parseRoleIdList(record.CL ?? ""),
    ML: parseRoleIdList(record.ML ?? ""),
    captain: parseRoleIdList(record.captain ?? ""),
    former_player: parseRoleIdList(record.former_player ?? ""),
    former_franchise_staff: parseRoleIdList(record.former_franchise_staff ?? ""),
  };
}

export function commaRoleList(roleIds: readonly string[]): string {
  return roleIds.join(", ");
}
