import type {DiscordInteraction} from "./types";

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

export function discordMessage(content: string, ephemeral = true): Response {
  return Response.json({
    type: 4,
    data: {
      content,
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

export async function editOriginalInteraction(
  interaction: DiscordInteraction,
  content: string,
): Promise<void> {
  if (!interaction.application_id || !interaction.token) {
    throw new Error("Discord interaction is missing application_id or token.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({content}),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord interaction update failed (${response.status}): ${body.slice(0, 500)}`);
  }
}

export function discordPong(): Response {
  return Response.json({type: 1});
}
