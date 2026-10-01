import {discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {analyzeReplay, type ReplayAnalysis} from "../replay/analyze";
import {ReplayParseError} from "../replay/header";
import type {
  DiscordAttachment,
  DiscordCommandOption,
  DiscordInteraction,
  Env,
  ExecutionContextLike,
} from "../types";

const MAX_REPLAY_BYTES = 15 * 1024 * 1024;
const ALLOWED_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

function getSubcommand(interaction: DiscordInteraction): DiscordCommandOption | null {
  const option = interaction.data?.options?.[0];
  return option?.type === 1 ? option : null;
}

function attachmentFor(
  interaction: DiscordInteraction,
  subcommand: DiscordCommandOption,
  name: string,
): DiscordAttachment | null {
  const option = subcommand.options?.find(candidate => candidate.name === name);
  if (option?.type !== 11 || typeof option.value !== "string") return null;
  return interaction.data?.resolved?.attachments?.[option.value] ?? null;
}

function validDiscordAttachmentUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_ATTACHMENT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function downloadReplay(attachment: DiscordAttachment): Promise<ArrayBuffer> {
  if (!attachment.filename.toLocaleLowerCase("en-US").endsWith(".replay")) {
    throw new Error("The attachment must be a Rocket League `.replay` file.");
  }

  if (attachment.size <= 0 || attachment.size > MAX_REPLAY_BYTES) {
    throw new Error("Replay attachments must be between 1 byte and 15 MiB.");
  }

  if (!validDiscordAttachmentUrl(attachment.url)) {
    throw new Error("Discord returned an unexpected attachment URL.");
  }

  const response = await fetch(attachment.url, {
    headers: {Accept: "application/octet-stream,*/*;q=0.1"},
  });
  if (!response.ok) {
    throw new Error(`Discord attachment download failed with HTTP ${response.status}.`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_REPLAY_BYTES) {
    throw new Error("Downloaded replay size is outside Hagrid's allowed range.");
  }

  return buffer;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function metric(value: number | null): string {
  return value === null ? "N/A" : value.toFixed(2);
}

function teamSection(analysis: ReplayAnalysis, team: 0 | 1): string[] {
  const heading = team === 0 ? "🔵 **Blue**" : "🟠 **Orange**";
  const players = analysis.players.filter(player => player.team === team);
  const lines = [heading];

  for (const player of players) {
    lines.push(
      `**${player.name}** — ${player.goals} G · ${player.assists} A · ${player.saves} SV · ${player.shots} SH`,
    );
    lines.push(
      `SR \`${metric(player.sr)}\` · OPI \`${metric(player.opi)}\` · DPI \`${metric(player.dpi)}\``,
    );
  }

  return lines;
}

function formatAnalysis(analysis: ReplayAnalysis, hash: string): string {
  const mode = analysis.teamSize > 0 ? `${analysis.teamSize}v${analysis.teamSize}` : "Unknown size";
  const lines = [
    `**Replay Analysis — ${mode}**`,
    `🔵 ${analysis.team0Score} — ${analysis.team1Score} 🟠`,
    ...teamSection(analysis, 0),
    "",
    ...teamSection(analysis, 1),
    "",
    `Replay hash: \`${hash.slice(0, 12)}\``,
  ];

  if (analysis.warnings.length > 0) {
    lines.push("", `⚠️ ${analysis.warnings.join(" ")}`);
  }

  return lines.join("\n").slice(0, 1950);
}

async function analyzeAndRespond(
  interaction: DiscordInteraction,
  attachment: DiscordAttachment,
): Promise<void> {
  try {
    const buffer = await downloadReplay(attachment);
    const [analysis, hash] = await Promise.all([
      Promise.resolve(analyzeReplay(buffer)),
      sha256(buffer),
    ]);
    await editOriginalInteraction(interaction, formatAnalysis(analysis, hash));
  } catch (error) {
    console.error("Replay analysis failed", error);
    const detail = error instanceof ReplayParseError
      ? `${error.message} (offset ${error.offset})`
      : error instanceof Error
        ? error.message
        : String(error);

    try {
      await editOriginalInteraction(
        interaction,
        `**Replay analysis failed**\n${detail.slice(0, 1500)}`,
      );
    } catch (responseError) {
      console.error("Failed to report replay error to Discord", responseError);
    }
  }
}

export async function handleReplayCommand(
  interaction: DiscordInteraction,
  _env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const subcommand = getSubcommand(interaction);
  if (!subcommand || subcommand.name !== "analyze") {
    return discordMessage("Choose `/replay analyze` and attach one Rocket League replay.");
  }

  const attachment = attachmentFor(interaction, subcommand, "file");
  if (!attachment) {
    return discordMessage("Attach one Rocket League `.replay` file.");
  }

  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  ctx.waitUntil(analyzeAndRespond(interaction, attachment));
  return discordDeferred();
}
