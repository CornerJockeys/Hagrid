import {handleActivityApi} from "./activity/http";
import {handleFranchiseCommand} from "./commands/franchise";
import {handleFaCommand, handleFaComponent} from "./commands/pool";
import {handleReplayCommand} from "./commands/replay";
import {handleStandingsCommand} from "./commands/standings";
import {handleSyncCommand} from "./commands/sync";
import {discordMessage, discordPong, verifyDiscordRequest} from "./discord";
import {readinessResponse} from "./readiness";
import {runScheduledScoutingRefresh} from "./scouting/refresh";
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

  try {
    if (interaction.type === 3) {
      if (interaction.data?.custom_id?.startsWith("fa:")) {
        return await handleFaComponent(interaction, env);
      }
      return discordMessage("That Discord component is not supported yet.");
    }

    if (interaction.type !== 2) {
      return discordMessage("That Discord interaction type is not supported yet.");
    }

    switch (interaction.data?.name) {
      case "franchise":
        return await handleFranchiseCommand(interaction, env);
      case "fa":
        return await handleFaCommand(interaction, env, ctx);
      case "replay":
        return await handleReplayCommand(interaction, env, ctx);
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

    if (request.method === "GET" && url.pathname === "/ready") {
      return readinessResponse(env);
    }

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteraction(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/activity/")) {
      try {
        return await handleActivityApi(request, env);
      } catch (error) {
        console.error("Activity API failed", error);
        return Response.json({error: "Hagrid hit an internal Activity error."}, {status: 500});
      }
    }

    return new Response("Hagrid", {status: 200});
  },

  scheduled(event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike): void {
    ctx.waitUntil(Promise.all([
      runScheduledSyncs(env, event),
      runScheduledScoutingRefresh(env, event),
    ]));
  },
};
