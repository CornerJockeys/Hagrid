import {getGuildConfig, setGuildFranchise} from "../db";
import {discordMessage} from "../discord";
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
    const config = await getGuildConfig(env.DB, guildId);
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

  const previous = await getGuildConfig(env.DB, guildId);
  const updated = await setGuildFranchise(env.DB, guildId, franchiseName, userId);

  if (previous?.franchise_name === updated.franchise_name) {
    return discordMessage(`Hagrid is already configured for **${updated.franchise_name}**.`);
  }

  if (previous) {
    return discordMessage(
      `Franchise changed from **${previous.franchise_name}** to **${updated.franchise_name}**.\n` +
      "The next dataset sync will resolve and validate the canonical Sprocket franchise entry.",
    );
  }

  return discordMessage(
    `Hagrid is now configured for **${updated.franchise_name}**.\n` +
    "The next dataset sync will resolve and validate the canonical Sprocket franchise entry.",
  );
}
