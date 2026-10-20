import {getConfiguredGuilds} from "../db";
import {sendDiscordThreadMessage} from "../discord";
import {CURRENT_MLE_SEASON, s20WeeklyReportKinds} from "../season-policy";
import {s20MatchWeekForNewWeekDate} from "../schedule/s20";
import type {Env, ScheduledEventLike} from "../types";
import {easternDate, easternHour, easternMinute} from "../reminders/logic";
import {dumpThreadId} from "./config";
import {buildDumpMessages, type DumpKind} from "./format";

async function alreadyPosted(
  env: Env,
  guildId: string,
  date: string,
  kind: DumpKind,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS present
     FROM weekly_dump_posts
     WHERE guild_id = ? AND season_number = ? AND report_date = ? AND kind = ?`,
  ).bind(guildId, CURRENT_MLE_SEASON, date, kind).first<{present: number}>();
  return Boolean(row?.present);
}

async function markPosted(
  env: Env,
  guildId: string,
  date: string,
  matchWeek: number,
  kind: DumpKind,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO weekly_dump_posts (
       guild_id, season_number, report_date, match_week, kind
     ) VALUES (?, ?, ?, ?, ?)`,
  ).bind(guildId, CURRENT_MLE_SEASON, date, matchWeek, kind).run();
}

export async function runScheduledDumps(env: Env, event: ScheduledEventLike): Promise<void> {
  const now = new Date(event.scheduledTime);
  const date = easternDate(now);
  if (easternHour(now) !== 13 || easternMinute(now) !== 30) return;

  const matchWeek = s20MatchWeekForNewWeekDate(date);
  if (!matchWeek) {
    // No scheduled Match Week begins today (for example a bye week).
    return;
  }

  const kinds = s20WeeklyReportKinds(date) as DumpKind[];
  if (kinds.length === 0) return;

  const guilds = await getConfiguredGuilds(env.DB);
  for (const guild of guilds) {
    for (const kind of kinds) {
      try {
        if (await alreadyPosted(env, guild.guild_id, date, kind)) continue;
        const messages = await buildDumpMessages(
          env,
          guild.franchise_name,
          kind,
          matchWeek,
        );
        const threadId = dumpThreadId(kind);
        for (const message of messages) {
          await sendDiscordThreadMessage(env, threadId, message);
        }
        await markPosted(env, guild.guild_id, date, matchWeek, kind);
        console.log(
          `Posted S${CURRENT_MLE_SEASON} ${kind} dump for ${guild.franchise_name}, Match Week ${matchWeek}.`,
        );
      } catch (error) {
        console.error(
          `Scheduled ${kind} dump failed for guild ${guild.guild_id} (${guild.franchise_name}).`,
          error,
        );
      }
    }
  }
}
