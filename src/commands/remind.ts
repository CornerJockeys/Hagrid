import {getGuildConfig} from "../db";
import {discordAutocomplete, discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {getLeagueTeamPlayers} from "../league/db";
import {isCompetitiveSlot, teamDivision, type TeamDivision} from "../league/view";
import {getEligibilityEvents} from "../sprocket/eligibility-data";
import type {DiscordInteraction, Env, ExecutionContextLike} from "../types";
import {easternDate, parseReminderDate} from "../reminders/logic";

const DIVISIONS = new Set<TeamDivision>(["FL", "AL", "CL", "ML"]);

function option(interaction: DiscordInteraction, name: string): string | number | boolean | null {
  return interaction.data?.options?.find(value => value.name === name)?.value ?? null;
}

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function requestedDivision(interaction: DiscordInteraction): TeamDivision | null {
  const value = option(interaction, "division");
  if (typeof value !== "string") return null;
  const normalized = value.toLocaleUpperCase("en-US") as TeamDivision;
  return DIVISIONS.has(normalized) ? normalized : null;
}

async function isFranchiseStaff(env: Env, guildId: string, discordId: string): Promise<boolean> {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return false;
  const result = await env.DB.prepare(
    `SELECT staff_position, slot
     FROM league_players_current
     WHERE LOWER(franchise_name) = LOWER(?) AND discord_id = ?`,
  ).bind(config.franchise_name, discordId).all<{staff_position: string | null; slot: string | null}>();
  return result.results.some(row => {
    if (row.staff_position?.trim()) return true;
    return /^(AGM|GM|CAPT|CAPTAIN)$/i.test(row.slot?.trim() ?? "");
  });
}

export async function handleRemindAutocomplete(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id) return discordAutocomplete([]);
  const focused = interaction.data?.options?.find(value => value.focused);
  if (focused?.name !== "player") return discordAutocomplete([]);

  const config = await getGuildConfig(env.DB, interaction.guild_id);
  if (!config) return discordAutocomplete([]);
  const division = requestedDivision(interaction);
  const query = typeof focused.value === "string" ? focused.value.trim().toLocaleLowerCase("en-US") : "";

  const players = await getLeagueTeamPlayers(env.DB, config.franchise_name);
  const filtered = players
    .filter(player => isCompetitiveSlot(player.slot))
    .filter(player => !division || teamDivision(player.skill_group) === division)
    .filter(player =>
      !query ||
      player.name.toLocaleLowerCase("en-US").includes(query) ||
      player.sprocket_player_id.toLocaleLowerCase("en-US").includes(query),
    )
    .slice(0, 25);

  return discordAutocomplete(filtered.map(player => ({
    name: `${player.name} — ${teamDivision(player.skill_group) ?? "—"} · ${player.slot ?? "—"}`.slice(0, 100),
    value: player.sprocket_player_id,
  })));
}

async function createReminder(
  interaction: DiscordInteraction,
  env: Env,
  playerId: string,
  targetScrims: number,
  dueDate: string,
  division: TeamDivision | null,
): Promise<void> {
  try {
    const guildId = interaction.guild_id!;
    const creatorId = invokerId(interaction)!;
    const channelId = interaction.channel_id!;

    if (!(await isFranchiseStaff(env, guildId, creatorId))) {
      await editOriginalInteraction(interaction, "Only current franchise staff and captains can create player scrim reminders.");
      return;
    }

    const config = await getGuildConfig(env.DB, guildId);
    if (!config) {
      await editOriginalInteraction(interaction, "No franchise is configured for this Discord server.");
      return;
    }

    const players = await getLeagueTeamPlayers(env.DB, config.franchise_name);
    const player = players.find(value => value.sprocket_player_id === playerId && isCompetitiveSlot(value.slot));
    if (!player) {
      await editOriginalInteraction(interaction, "That player is not on this franchise's current competitive roster.");
      return;
    }

    const actualDivision = teamDivision(player.skill_group);
    if (division && actualDivision !== division) {
      await editOriginalInteraction(
        interaction,
        `${player.name} is currently rostered in ${actualDivision ?? "an unknown division"}, not ${division}.`,
      );
      return;
    }

    if (!player.discord_id) {
      await editOriginalInteraction(interaction, `${player.name} does not have a linked Discord ID, so Hagrid cannot ping them.`);
      return;
    }

    const events = await getEligibilityEvents(env, playerId);
    const baseline = events.filter(event => event.points > 0).length;

    const result = await env.DB.prepare(
      `INSERT INTO scrim_reminders (
         guild_id, channel_id, franchise_name, sprocket_player_id, player_discord_id,
         player_name, division, target_scrims, baseline_scrim_events, due_date,
         cadence, created_by_discord_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?)`,
    ).bind(
      guildId,
      channelId,
      config.franchise_name,
      player.sprocket_player_id,
      player.discord_id,
      player.name,
      actualDivision,
      targetScrims,
      baseline,
      dueDate,
      creatorId,
    ).run();

    if (!result.success) throw new Error("Failed to save scrim reminder.");

    await editOriginalInteraction(
      interaction,
      `🔔 Reminder set for <@${player.discord_id}>: **${targetScrims} scrim${targetScrims === 1 ? "" : "s"}** before **${dueDate}**.\nNormal cadence pings every 2 days, anchored to the deadline, with a final ping on the deadline day. Hagrid will close it automatically when the goal is reached and notify <@${creatorId}>.`,
    );
  } catch (error) {
    console.error("Create reminder failed", error);
    await editOriginalInteraction(interaction, "Hagrid hit an error while creating that reminder.");
  }
}

export async function handleRemindCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Scrim reminders can only be created inside a Discord server channel.");
  }

  const creatorId = invokerId(interaction);
  if (!creatorId) return discordMessage("Hagrid could not identify who created this reminder.");

  const player = option(interaction, "player");
  const scrims = option(interaction, "scrims");
  const before = option(interaction, "before");
  if (typeof player !== "string" || !player.trim()) return discordMessage("Choose a franchise player.");
  if (typeof scrims !== "number" || !Number.isInteger(scrims) || scrims < 1 || scrims > 50) {
    return discordMessage("Scrim goal must be a whole number from 1 to 50.");
  }
  if (typeof before !== "string") return discordMessage("Provide a deadline.");

  const dueDate = parseReminderDate(before);
  if (!dueDate) return discordMessage("Use a deadline like 10/24/2026 or 2026-10-24.");
  if (dueDate < easternDate()) return discordMessage("The reminder deadline cannot be in the past.");

  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  ctx.waitUntil(createReminder(interaction, env, player.trim(), scrims, dueDate, requestedDivision(interaction)));
  return discordDeferred(false);
}
