import {getConfiguredGuilds} from "../db";
import type {Env, ScheduledEventLike} from "../types";
import {runFranchiseSync} from "./weekly";

const easternClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function easternParts(timestamp: number): {weekday: string; hour: number; minute: number} {
  const parts = easternClock.formatToParts(new Date(timestamp));
  const lookup = new Map(parts.map(part => [part.type, part.value]));

  return {
    weekday: lookup.get("weekday") ?? "",
    hour: Number(lookup.get("hour") ?? "-1"),
    minute: Number(lookup.get("minute") ?? "-1"),
  };
}

export function isWeeklySyncTime(timestamp: number): boolean {
  const parts = easternParts(timestamp);
  return parts.weekday === "Mon" && parts.hour === 13 && parts.minute === 0;
}

export async function runScheduledSyncs(env: Env, event: ScheduledEventLike): Promise<void> {
  if (!isWeeklySyncTime(event.scheduledTime)) {
    console.log(`Skipping cron ${event.cron}; it is not Monday 1:00 PM America/New_York.`);
    return;
  }

  const guilds = await getConfiguredGuilds(env.DB);
  for (const guild of guilds) {
    try {
      const summary = await runFranchiseSync(env, guild.guild_id, "scheduled", null);
      console.log(
        `Scheduled sync succeeded for guild ${guild.guild_id} (${summary.franchiseName}), run ${summary.runId}.`,
      );
    } catch (error) {
      console.error(
        `Scheduled sync failed for guild ${guild.guild_id} (${guild.franchise_name}).`,
        error,
      );
    }
  }
}
