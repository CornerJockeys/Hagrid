import type {Env} from "../types";

export async function recordSimulatedWrite(
  env: Env,
  input: {
    guildId: string;
    commandName: string;
    operationName: string;
    targetName: string;
    payload: unknown;
    createdByDiscordId: string;
  },
): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT INTO simulated_writes (
       guild_id, command_name, operation_name, target_name, payload_json, created_by_discord_id
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.guildId,
    input.commandName,
    input.operationName,
    input.targetName,
    JSON.stringify(input.payload),
    input.createdByDiscordId,
  ).run();

  if (!result.success) {
    throw new Error("Failed to record simulated write.");
  }
}
