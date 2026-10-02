import {discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import type {DiscordCommandOption, DiscordInteraction, Env, ExecutionContextLike} from "../types";

interface ReminderRow {
  id: number;
  player_discord_id: string;
  player_name: string;
  division: string | null;
  target_scrims: number;
  baseline_scrim_events: number;
  due_date: string;
  cadence: string;
  created_by_discord_id: string;
  created_at: string;
  status: string;
}

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function subcommand(interaction: DiscordInteraction): DiscordCommandOption | null {
  return interaction.data?.options?.find(value => value.type === 1) ?? null;
}

function nestedOption(
  interaction: DiscordInteraction,
  name: string,
): string | number | boolean | null {
  return subcommand(interaction)?.options?.find(value => value.name === name)?.value ?? null;
}

function hasManageGuild(interaction: DiscordInteraction): boolean {
  const raw = interaction.member?.permissions;
  if (!raw) return false;
  try {
    return (BigInt(raw) & 0x20n) !== 0n;
  } catch {
    return false;
  }
}

function reminderLine(reminder: ReminderRow, perspective: "created" | "assigned"): string {
  const subject = perspective === "created"
    ? `<@${reminder.player_discord_id}>`
    : `set by <@${reminder.created_by_discord_id}>`;
  const division = reminder.division ? ` · ${reminder.division}` : "";
  return `#${reminder.id} · **${reminder.target_scrims} scrim${reminder.target_scrims === 1 ? "" : "s"}** by **${reminder.due_date}**${division} · ${subject}`;
}

async function listReminders(interaction: DiscordInteraction, env: Env): Promise<void> {
  try {
    const userId = invokerId(interaction)!;
    const guildId = interaction.guild_id!;

    const result = await env.DB.prepare(
      `SELECT id, player_discord_id, player_name, division, target_scrims,
              baseline_scrim_events, due_date, cadence, created_by_discord_id,
              created_at, status
       FROM scrim_reminders
       WHERE guild_id = ? AND status = 'active'
         AND (created_by_discord_id = ? OR player_discord_id = ?)
       ORDER BY due_date, id
       LIMIT 50`,
    ).bind(guildId, userId, userId).all<ReminderRow>();

    const created = result.results.filter(row => row.created_by_discord_id === userId);
    const assigned = result.results.filter(row =>
      row.player_discord_id === userId && row.created_by_discord_id !== userId,
    );

    const lines = ["**Active Scrim Reminders**"];
    if (created.length === 0 && assigned.length === 0) {
      lines.push("You do not have any active scrim reminders.");
    }
    if (assigned.length > 0) {
      lines.push("", "**For you**");
      for (const row of assigned) lines.push(reminderLine(row, "assigned"));
    }
    if (created.length > 0) {
      lines.push("", "**Created by you**");
      for (const row of created) lines.push(reminderLine(row, "created"));
      lines.push("", "Use `/reminders cancel id:<number>` to cancel one you created.");
    }

    await editOriginalInteraction(interaction, lines.join("\n").slice(0, 1950));
  } catch (error) {
    console.error("List reminders failed", error);
    await editOriginalInteraction(interaction, "Hagrid hit an error while loading reminders.");
  }
}

async function cancelReminder(
  interaction: DiscordInteraction,
  env: Env,
  reminderId: number,
): Promise<void> {
  try {
    const userId = invokerId(interaction)!;
    const guildId = interaction.guild_id!;

    const reminder = await env.DB.prepare(
      `SELECT id, player_discord_id, player_name, division, target_scrims,
              baseline_scrim_events, due_date, cadence, created_by_discord_id,
              created_at, status
       FROM scrim_reminders
       WHERE guild_id = ? AND id = ?
       LIMIT 1`,
    ).bind(guildId, reminderId).first<ReminderRow>();

    if (!reminder || reminder.status !== "active") {
      await editOriginalInteraction(interaction, `Reminder #${reminderId} is not active or does not exist in this server.`);
      return;
    }

    if (reminder.created_by_discord_id !== userId && !hasManageGuild(interaction)) {
      await editOriginalInteraction(interaction, "Only the person who created that reminder (or a server manager) can cancel it.");
      return;
    }

    const result = await env.DB.prepare(
      `UPDATE scrim_reminders
       SET status = 'cancelled', closed_at = CURRENT_TIMESTAMP
       WHERE guild_id = ? AND id = ? AND status = 'active'`,
    ).bind(guildId, reminderId).run();
    if (!result.success) throw new Error("Failed to cancel reminder.");

    await editOriginalInteraction(
      interaction,
      `🛑 Reminder #${reminderId} for <@${reminder.player_discord_id}> (**${reminder.target_scrims} scrim${reminder.target_scrims === 1 ? "" : "s"}** by **${reminder.due_date}**) has been cancelled.`,
    );
  } catch (error) {
    console.error("Cancel reminder failed", error);
    await editOriginalInteraction(interaction, "Hagrid hit an error while cancelling that reminder.");
  }
}

export async function handleRemindersCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!interaction.guild_id) return discordMessage("Reminder management can only be used inside a Discord server.");
  if (!invokerId(interaction)) return discordMessage("Hagrid could not identify your Discord account.");
  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  const command = subcommand(interaction)?.name ?? "list";
  if (command === "list") {
    ctx.waitUntil(listReminders(interaction, env));
    return discordDeferred(true);
  }

  if (command === "cancel") {
    const id = nestedOption(interaction, "id");
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      return discordMessage("Choose a valid reminder ID to cancel.");
    }
    ctx.waitUntil(cancelReminder(interaction, env, id));
    return discordDeferred(true);
  }

  return discordMessage("Unknown reminders action.");
}
