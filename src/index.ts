import {handleFranchiseCommand} from "./commands/franchise";
import {handleStandingsCommand} from "./commands/standings";
import {handleSyncCommand} from "./commands/sync";
import {discordMessage, discordPong, verifyDiscordRequest} from "./discord";
import {runScheduledSyncs} from "./sync/scheduled";
import type {
  DiscordInteraction,
  Env,
  ExecutionContextLike,
  ScheduledEventLike,
} from "./types";

async function handleInteraction(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const rawBody = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
  if (!rawBody) {
    return new Response("Invalid request signature.", {status: 401});
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON.", {status: 400});
  }

  if (interaction.type === 1) {
    return discordPong();
  }

  if (interaction.type !== 2) {
    return discordMessage("That Discord interaction type is not supported yet.");
  }

  try {
    switch (interaction.data?.name) {
      case "franchise":
        return await handleFranchiseCommand(interaction, env);
      case "standings":
        return await handleStandingsCommand(interaction, env, ctx);
      case "sync":
        return await handleSyncCommand(interaction, env, ctx);
      default:
        return discordMessage("Unknown command.");
    }
  } catch (error) {
    console.error("Interaction failed", error);
    return discordMessage("Hagrid hit an internal error while processing that command.");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "hagrid",
      });
    }

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteraction(request, env, ctx);
    }

    return new Response("Hagrid", {status: 200});
  },

  scheduled(event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike): void {
    ctx.waitUntil(runScheduledSyncs(env, event));
  },
};
