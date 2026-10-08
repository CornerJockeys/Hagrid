import type {DiscordInteraction, Env} from "./types";

const encoder = new TextEncoder();

function hexToBuffer(value: string): ArrayBuffer {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error("Invalid hex value.");
  }

  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    output[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return output.buffer as ArrayBuffer;
}

function textToBuffer(value: string): ArrayBuffer {
  return encoder.encode(value).buffer as ArrayBuffer;
}

export async function verifyDiscordRequest(
  request: Request,
  publicKeyHex: string,
): Promise<string | null> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!signature || !timestamp || !publicKeyHex) {
    return null;
  }

  const body = await request.text();

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      hexToBuffer(publicKeyHex),
      {name: "Ed25519"},
      false,
      ["verify"],
    );

    const valid = await crypto.subtle.verify(
      {name: "Ed25519"},
      publicKey,
      hexToBuffer(signature),
      textToBuffer(timestamp + body),
    );

    return valid ? body : null;
  } catch {
    return null;
  }
}

export function discordMessage(
  content: string,
  ephemeral = true,
  components: unknown[] = [],
): Response {
  return Response.json({
    type: 4,
    data: {
      content,
      components,
      ...(ephemeral ? {flags: 64} : {}),
    },
  });
}

export function discordDeferred(ephemeral = true): Response {
  return Response.json({
    type: 5,
    data: {
      ...(ephemeral ? {flags: 64} : {}),
    },
  });
}

export function discordAutocomplete(
  choices: Array<{name: string; value: string | number}>,
): Response {
  return Response.json({
    type: 8,
    data: {choices: choices.slice(0, 25)},
  });
}

export function discordUpdateMessage(content: string, components: unknown[] = []): Response {
  return Response.json({
    type: 7,
    data: {content, components},
  });
}

export async function editOriginalInteraction(
  interaction: DiscordInteraction,
  content: string,
  components: unknown[] = [],
): Promise<void> {
  if (!interaction.application_id || !interaction.token) {
    throw new Error("Discord interaction is missing application_id or token.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({content, components}),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord interaction update failed (${response.status}): ${body.slice(0, 500)}`);
  }
}

export async function sendDiscordChannelMessage(
  env: Env,
  channelId: string,
  content: string,
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured.");
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({content, components, allowed_mentions: {parse: ["users"]}}),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord channel message failed (${response.status}): ${body.slice(0, 500)}`);
  }
}

async function postDiscordMessage(
  env: Env,
  channelId: string,
  content: string,
  components: unknown[] = [],
): Promise<Response> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured.");
  return fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({content, allowed_mentions: {parse: ["users"]}}),
  });
}

export async function sendDiscordThreadMessage(
  env: Env,
  threadId: string,
  content: string,
  components: unknown[] = [],
): Promise<void> {
  let response = await postDiscordMessage(env, threadId, content, components);
  if (response.ok) return;

  const firstBody = await response.text();

  // Bots sometimes need to explicitly join an existing thread before posting.
  // Attempt that once for common access/permission failures, then retry.
  if (
    env.DISCORD_BOT_TOKEN &&
    (response.status === 403 || response.status === 404)
  ) {
    const join = await fetch(
      `https://discord.com/api/v10/channels/${threadId}/thread-members/@me`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        },
      },
    );

    if (join.ok || join.status === 204) {
      response = await postDiscordMessage(env, threadId, content, components);
      if (response.ok) return;
      const retryBody = await response.text();
      throw new Error(
        `Discord thread message failed after join (${response.status}): ${retryBody.slice(0, 500)}`,
      );
    }

    const joinBody = await join.text();
    throw new Error(
      `Discord thread access failed (post ${response.status}: ${firstBody.slice(0, 250)}; join ${join.status}: ${joinBody.slice(0, 250)})`,
    );
  }

  throw new Error(
    `Discord thread message failed (${response.status}): ${firstBody.slice(0, 500)}`,
  );
}

export function discordPong(): Response {
  return Response.json({type: 1});
}
