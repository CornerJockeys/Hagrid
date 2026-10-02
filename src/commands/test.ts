import {getGuildConfig} from "../db";
import {discordMessage, discordUpdateMessage, sendDiscordThreadMessage} from "../discord";
import {dumpThreadId} from "../dumps/config";
import {buildDumpMessages, type DumpKind} from "../dumps/format";
import type {DiscordCommandOption, DiscordInteraction, Env} from "../types";

const DUMP_KINDS = new Set<DumpKind>(["eligibility", "salary", "usage"]);

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function selectedValue(interaction: DiscordInteraction): string | null {
  const value = interaction.data?.values?.[0];
  return typeof value === "string" && value ? value : null;
}

function subcommand(interaction: DiscordInteraction): DiscordCommandOption | null {
  return interaction.data?.options?.find(option => option.type === 1) ?? null;
}

function dumpKindComponents(userId: string): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `test:dump-kind:${userId}`,
      placeholder: "Choose a dump to simulate",
      min_values: 1,
      max_values: 1,
      options: [
        {label: "Eligibility", value: "eligibility"},
        {label: "Salary", value: "salary"},
        {label: "Usage", value: "usage"},
        {label: "All three", value: "all"},
      ],
    }],
  }];
}

function matchWeekComponents(userId: string, kind: string): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `test:dump-week:${userId}:${kind}`,
      placeholder: "Choose the Match Week label",
      min_values: 1,
      max_values: 1,
      options: Array.from({length: 10}, (_, index) => ({
        label: `Match Week ${index + 1}`,
        value: String(index + 1),
      })),
    }],
  }];
}

async function runDump(
  interaction: DiscordInteraction,
  env: Env,
  kind: DumpKind | "all",
  matchWeek: number,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Dump tests can only run inside a Discord server channel.");
  }

  const config = await getGuildConfig(env.DB, interaction.guild_id);
  if (!config) return discordMessage("No franchise is configured for this Discord server.");

  const kinds: DumpKind[] = kind === "all"
    ? ["eligibility", "salary", "usage"]
    : [kind];

  const completed: DumpKind[] = [];
  for (const dumpKind of kinds) {
    try {
      const messages = await buildDumpMessages(env, config.franchise_name, dumpKind, matchWeek);
      const threadId = dumpThreadId(dumpKind);
      for (let index = 0; index < messages.length; index += 1) {
        const prefix = index === 0 ? "**[TEST DUMP]**\n" : "**[TEST DUMP — continued]**\n";
        await sendDiscordThreadMessage(env, threadId, prefix + messages[index]);
      }
      completed.push(dumpKind);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Test dump failed", {dumpKind, matchWeek, detail});
      return discordUpdateMessage(
        [
          `❌ The **${dumpKind}** test dump failed for Match Week ${matchWeek}.`,
          completed.length > 0 ? `Already posted successfully: **${completed.join(", ")}**.` : "",
          `Error: \`${detail.slice(0, 1200)}\``,
          "",
          "If this is a Discord thread permission/access issue, make sure Hagrid can **View Channel**, **Send Messages in Threads**, and access that thread.",
        ].filter(Boolean).join("\n"),
        [],
      );
    }
  }

  return discordUpdateMessage(
    `✅ Test ${kind === "all" ? "eligibility, salary, and usage dumps" : kind + " dump"} posted to the configured S20 dump thread${kind === "all" ? "s" : ""} for Match Week ${matchWeek}. This simulates the actual weekly Discord output without changing scheduled state.`,
    [],
  );
}

export async function handleTestCommand(
  interaction: DiscordInteraction,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Test commands can only be used inside a Discord server channel.");
  }
  const userId = invokerId(interaction);
  if (!userId) return discordMessage("Hagrid could not identify your Discord account.");

  if (subcommand(interaction)?.name !== "dump") {
    return discordMessage("Unknown test action.");
  }

  return discordMessage(
    "**Test weekly dump**\nChoose which dump to simulate. It will post to the configured S20 dump thread and will not alter scheduled dump state.",
    true,
    dumpKindComponents(userId),
  );
}

export async function handleTestComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const parts = (interaction.data?.custom_id ?? "").split(":");
  if (parts[0] !== "test" || parts[1]?.startsWith("dump") !== true) {
    return discordMessage("That test control is no longer valid.");
  }

  const actorId = invokerId(interaction);
  const userId = parts[2];
  if (!actorId || !userId || actorId !== userId) {
    return discordMessage("Only the person who started this test can continue it.");
  }

  if (parts[1] === "dump-kind") {
    const kind = selectedValue(interaction);
    if (!kind || (kind !== "all" && !DUMP_KINDS.has(kind as DumpKind))) {
      return discordUpdateMessage("Choose a valid dump type.", dumpKindComponents(userId));
    }
    return discordUpdateMessage(
      "**Test weekly dump**\nChoose the Match Week number to put in the title.",
      matchWeekComponents(userId, kind),
    );
  }

  if (parts[1] === "dump-week") {
    const kind = parts[3] as DumpKind | "all";
    const rawWeek = selectedValue(interaction);
    const matchWeek = rawWeek ? Number(rawWeek) : NaN;
    if (
      (kind !== "all" && !DUMP_KINDS.has(kind as DumpKind)) ||
      !Number.isInteger(matchWeek) ||
      matchWeek < 1 ||
      matchWeek > 10
    ) {
      return discordMessage("That test dump selection is no longer valid.");
    }
    return runDump(interaction, env, kind, matchWeek);
  }

  return discordMessage("That test control is no longer valid.");
}
