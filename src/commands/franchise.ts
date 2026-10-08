import {getCachedGuildConfig, setCachedGuildFranchise} from "../config-cache";
import {discordMessage} from "../discord";
import {DatasetFetchError} from "../sprocket/client";
import {resolveFranchise, type SprocketFranchise} from "../sprocket/franchises";
import type {DiscordCommandOption, DiscordInteraction, Env} from "../types";

const MANAGE_GUILD = 0x20n;

function hasManageGuild(interaction: DiscordInteraction): boolean {
  const rawPermissions = interaction.member?.permissions;
  if (!rawPermissions) return false;

  try {
    return (BigInt(rawPermissions) & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function getSubcommand(interaction: DiscordInteraction): DiscordCommandOption | null {
  const option = interaction.data?.options?.[0];
  return option?.type === 1 ? option : null;
}

function getStringOption(option: DiscordCommandOption, name: string): string | null {
  const value = option.options?.find(candidate => candidate.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function normalizeFranchiseName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatFranchise(franchise: SprocketFranchise): string {
  return franchise.code ? `${franchise.name} (${franchise.code})` : franchise.name;
}

export async function handleFranchiseCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return discordMessage("Franchise configuration can only be used inside a Discord server.");
  }

  const subcommand = getSubcommand(interaction);
  if (!subcommand) {
    return discordMessage("Choose either `/franchise set` or `/franchise show`.");
  }

  if (subcommand.name === "show") {
    const config = await getCachedGuildConfig(env, guildId);
    if (!config) {
      return discordMessage("Hagrid does not have a franchise configured for this server yet.");
    }

    const code = config.franchise_code ? ` (${config.franchise_code})` : "";
    return discordMessage(
      `Configured franchise: **${config.franchise_name}**${code}\nLast updated: ${config.updated_at} UTC`,
    );
  }

  if (subcommand.name !== "set") {
    return discordMessage("Unknown franchise subcommand.");
  }

  if (!hasManageGuild(interaction)) {
    return discordMessage("You need the **Manage Server** permission to change Hagrid's franchise.");
  }

  const userId = invokerId(interaction);
  if (!userId) {
    return discordMessage("I could not identify the user making this change.");
  }

  const requestedName = getStringOption(subcommand, "name");
  if (!requestedName) {
    return discordMessage("A franchise name is required.");
  }

  const franchiseName = normalizeFranchiseName(requestedName);
  if (franchiseName.length < 2 || franchiseName.length > 100) {
    return discordMessage("Franchise names must be between 2 and 100 characters.");
  }

  let resolution;
  try {
    resolution = await resolveFranchise(env, franchiseName);
  } catch (error) {
    if (error instanceof DatasetFetchError) {
      console.error("Franchise dataset lookup failed", error);
      return discordMessage(
        "I could not reach or parse the current Sprocket franchise dataset. No configuration was changed.",
      );
    }
    throw error;
  }

  if (!resolution.match) {
    const suggestions = resolution.suggestions.length > 0
      ? `\nPossible matches: ${resolution.suggestions.map(formatFranchise).join(", ")}`
      : "";
    return discordMessage(
      `I could not find an exact Sprocket franchise match for \`${franchiseName}\`.${suggestions}\n` +
      "No configuration was changed.",
    );
  }

  const match = resolution.match;
  const previous = await getCachedGuildConfig(env, guildId);

  if (
    previous?.franchise_name === match.name &&
    (previous.franchise_code ?? null) === (match.code ?? null)
  ) {
    return discordMessage(`Hagrid is already configured for **${formatFranchise(match)}**.`);
  }

  const updated = await setCachedGuildFranchise(
    env,
    guildId,
    match.name,
    match.code,
    userId,
  );
  const updatedLabel = updated.franchise_code
    ? `${updated.franchise_name} (${updated.franchise_code})`
    : updated.franchise_name;

  if (previous) {
    const previousLabel = previous.franchise_code
      ? `${previous.franchise_name} (${previous.franchise_code})`
      : previous.franchise_name;
    return discordMessage(
      `Franchise changed from **${previousLabel}** to **${updatedLabel}**.\n` +
      "The new franchise was validated against the current Sprocket teams dataset.",
    );
  }

  return discordMessage(
    `Hagrid is now configured for **${updatedLabel}**.\n` +
    "The franchise was validated against the current Sprocket teams dataset.",
  );
}
