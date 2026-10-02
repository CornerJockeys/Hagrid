import {sendDiscordChannelMessage} from "../discord";
import {getEligibilityEvents} from "../sprocket/eligibility-data";
import type {Env} from "../types";
import {easternDate, easternHour, normalReminderDue} from "./logic";

interface ReminderRow {
  id: number;
  guild_id: string;
  channel_id: string;
  sprocket_player_id: string;
  player_discord_id: string;
  player_name: string;
  target_scrims: number;
  baseline_scrim_events: number;
  due_date: string;
  cadence: string;
  created_by_discord_id: string;
  last_ping_date: string | null;
}

async function close(
  env: Env,
  id: number,
  status: "completed" | "missed",
  completed = false,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE scrim_reminders
     SET status = ?, closed_at = CURRENT_TIMESTAMP,
         completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END
     WHERE id = ? AND status = 'active'`,
  ).bind(status, completed ? 1 : 0, id).run();
}

export async function runScheduledReminders(env: Env): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    console.warn("Reminder scheduler skipped because DISCORD_BOT_TOKEN is not configured.");
    return;
  }

  const now = new Date();
  const today = easternDate(now);
  const hour = easternHour(now);
  const rows = await env.DB.prepare(
    `SELECT id, guild_id, channel_id, sprocket_player_id, player_discord_id, player_name,
            target_scrims, baseline_scrim_events, due_date, cadence,
            created_by_discord_id, last_ping_date
     FROM scrim_reminders
     WHERE status = 'active'
     ORDER BY due_date, id`,
  ).all<ReminderRow>();

  if (rows.results.length === 0) return;

  const events = await getEligibilityEvents(env);
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.points <= 0) continue;
    counts.set(event.playerId, (counts.get(event.playerId) ?? 0) + 1);
  }

  for (const reminder of rows.results) {
    const current = counts.get(reminder.sprocket_player_id) ?? 0;
    const completedScrims = Math.max(0, current - reminder.baseline_scrim_events);

    if (completedScrims >= reminder.target_scrims) {
      await sendDiscordChannelMessage(
        env,
        reminder.channel_id,
        `✅ <@${reminder.created_by_discord_id}> — <@${reminder.player_discord_id}> completed their **${reminder.target_scrims}-scrim** reminder goal for **${reminder.due_date}**.`,
      );
      await close(env, reminder.id, "completed", true);
      continue;
    }

    if (today > reminder.due_date) {
      await sendDiscordChannelMessage(
        env,
        reminder.channel_id,
        `⚠️ <@${reminder.created_by_discord_id}> — <@${reminder.player_discord_id}>'s scrim reminder ended at **${completedScrims}/${reminder.target_scrims}** after the **${reminder.due_date}** deadline.`,
      );
      await close(env, reminder.id, "missed");
      continue;
    }

    if (
      reminder.cadence === "normal" &&
      hour === 13 &&
      reminder.last_ping_date !== today &&
      normalReminderDue(reminder.due_date, today)
    ) {
      await sendDiscordChannelMessage(
        env,
        reminder.channel_id,
        `🔔 <@${reminder.player_discord_id}> — scrim reminder: **${completedScrims}/${reminder.target_scrims}** completed. Goal: **${reminder.target_scrims} scrim${reminder.target_scrims === 1 ? "" : "s"}** by **${reminder.due_date}**.`,
      );
      await env.DB.prepare(
        `UPDATE scrim_reminders SET last_ping_date = ? WHERE id = ? AND status = 'active'`,
      ).bind(today, reminder.id).run();
    }
  }
}
