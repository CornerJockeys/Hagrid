import {hasGmFmRoleIds} from "../discord-roles";
import {
  getRoleAutomationConfig,
  saveRoleAutomationConfig,
} from "../role-automation";
import {
  commaRoleList,
  parseRoleAutomationPayload,
} from "../role-automation-policy";
import type {Env} from "../types";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

function forbidden(): Response {
  return Response.json(
    {error: "Role Automation is limited to current GM/FM staff."},
    {status: 403},
  );
}

export async function getActivityRoleAutomation(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;
  if (!hasGmFmRoleIds(auth.roleIds)) return forbidden();

  const config = await getRoleAutomationConfig(env, auth.guildId);
  return Response.json({
    mappings: {
      new_member: commaRoleList(config.mappings.new_member),
      FL: commaRoleList(config.mappings.FL),
      AL: commaRoleList(config.mappings.AL),
      CL: commaRoleList(config.mappings.CL),
      ML: commaRoleList(config.mappings.ML),
      captain: commaRoleList(config.mappings.captain),
      former_player: commaRoleList(config.mappings.former_player),
      former_franchise_staff: commaRoleList(config.mappings.former_franchise_staff),
    },
    updated_at: config.updatedAt,
    updated_by_discord_id: config.updatedByDiscordId,
  });
}

export async function saveActivityRoleAutomation(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;
  if (!hasGmFmRoleIds(auth.roleIds)) return forbidden();

  let body: {mappings?: unknown};
  try {
    body = await request.json() as {mappings?: unknown};
  } catch {
    return Response.json({error: "Invalid JSON body."}, {status: 400});
  }

  let mappings;
  try {
    mappings = parseRoleAutomationPayload(body.mappings);
  } catch (error) {
    return Response.json(
      {error: error instanceof Error ? error.message : String(error)},
      {status: 400},
    );
  }

  const saved = await saveRoleAutomationConfig(
    env,
    auth.guildId,
    auth.userId,
    mappings,
  );

  return Response.json({
    ok: true,
    mappings: {
      new_member: commaRoleList(saved.mappings.new_member),
      FL: commaRoleList(saved.mappings.FL),
      AL: commaRoleList(saved.mappings.AL),
      CL: commaRoleList(saved.mappings.CL),
      ML: commaRoleList(saved.mappings.ML),
      captain: commaRoleList(saved.mappings.captain),
      former_player: commaRoleList(saved.mappings.former_player),
      former_franchise_staff: commaRoleList(saved.mappings.former_franchise_staff),
    },
    updated_at: saved.updatedAt,
    updated_by_discord_id: saved.updatedByDiscordId,
  });
}
