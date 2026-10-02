import {sendDiscordChannelMessage} from "../discord";
import type {Env} from "../types";
import {easternDate, easternHour, reminderDue} from "./logic";

interface ReminderRow {
  id: number;
  channel_id: string;
  player_discord_id: string;
  player_name: string;
  division: string | null;
  due_date: string;
  cadence: string;
  created_by_discord_id: string;
  last_ping_date: string | null;
}

async function close(env: Env, id: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE scrim_reminders
     SET status = 'completed', completed_at = CURRENT_TIMESTAMP, closed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'active'`,
  ).bind(id).run();
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
    `SELECT id, channel_id, player_discord_id, player_name, division, due_date,
            cadence, created_by_discord_id, last_ping_date
     FROM scrim_reminders
     WHERE status = 'active'
     ORDER BY due_date, id`,
  ).all<ReminderRow>();

  for (const reminder of rows.results) {
    if (today > reminder.due_date) {
      await close(env, reminder.id);
      continue;
    }

    if (
      hour === 13 &&
      reminder.last_ping_date !== today &&
      reminderDue(reminder.cadence, reminder.due_date, today)
    ) {
      const division = reminder.division ? ` (${reminder.division})` : "";
      await sendDiscordChannelMessage(
        env,
        reminder.channel_id,
        `🔔 <@${reminder.player_discord_id}> — reminder from <@${reminder.created_by_discord_id}>: please take care of your league reminder${division} before **${reminder.due_date}**.`,
      );
      await env.DB.prepare(
        `UPDATE scrim_reminders SET last_ping_date = ? WHERE id = ? AND status = 'active'`,
      ).bind(today, reminder.id).run();

      if (today === reminder.due_date) {
        await close(env, reminder.id);
      }
    }
  }
}
