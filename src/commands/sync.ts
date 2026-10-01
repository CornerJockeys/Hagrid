import {discordDeferred, discordMessage, editOriginalInteraction} from "../discord";
import {CURRENT_MLE_SEASON} from "../season-policy";
import {getLatestSyncRun} from "../sync/db";
import {
  FranchiseSyncError,
  runFranchiseSync,
  type PlayerChange,
  type SyncSummary,
} from "../sync/weekly";
import type {
  DiscordCommandOption,
  DiscordInteraction,
  Env,
  ExecutionContextLike,
} from "../types";

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

function formatChangeCounts(changes: PlayerChange[]): string {
  if (changes.length === 0) return "No player changes detected.";

  const order: PlayerChange["type"][] = [
    "joined",
    "left",
    "slot",
    "salary",
    "eligibility",
    "scrim_points",
    "name",
  ];
  const labels: Record<PlayerChange["type"], string> = {
    joined: "Joined",
    left: "Left",
    slot: "Slot",
    salary: "Salary",
    eligibility: "Eligibility",
    scrim_points: "Scrim points",
    name: "Name",
  };

  return order
    .map(type => ({type, count: changes.filter(change => change.type === type).length}))
    .filter(item => item.count > 0)
    .map(item => `${labels[item.type]}: ${item.count}`)
    .join(" · ");
}

function formatSuccess(summary: SyncSummary): string {
  const franchise = summary.franchiseCode
    ? `${summary.franchiseName} (${summary.franchiseCode})`
    : summary.franchiseName;
  const usage = summary.usageSeason === null
    ? `awaiting S${CURRENT_MLE_SEASON} role-usage data`
    : `${summary.usageCount} role-usage rows (Season ${summary.usageSeason})`;

  return [
    `**${franchise} sync complete**`,
    `Run: \`${summary.runId.slice(0, 8)}\``,
    `Players: ${summary.playerCount}`,
    `Usage: ${usage}`,
    `Changes: ${summary.changes.length}`,
    formatChangeCounts(summary.changes),
  ].join("\n").slice(0, 1900);
}

async function runAndRespond(
  interaction: DiscordInteraction,
  env: Env,
  guildId: string,
  userId: string,
): Promise<void> {
  try {
    const summary = await runFranchiseSync(env, guildId, "manual", userId);
    await editOriginalInteraction(interaction, formatSuccess(summary));
  } catch (error) {
    const runId = error instanceof FranchiseSyncError ? error.runId.slice(0, 8) : null;
    const message = error instanceof Error ? error.message : String(error);
    const runLine = runId ? `\nRun: \`${runId}\`` : "";

    try {
      await editOriginalInteraction(
        interaction,
        `**Sync failed**${runLine}\n${message.slice(0, 1200)}\n` +
          "The previously promoted franchise data was left unchanged.",
      );
    } catch (responseError) {
      console.error("Failed to report sync failure to Discord", responseError);
    }
  }
}

export async function handleSyncCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return discordMessage("Sync commands can only be used inside a Discord server.");
  }

  if (!hasManageGuild(interaction)) {
    return discordMessage("You need the **Manage Server** permission to run or inspect Hagrid syncs.");
  }

  const subcommand = getSubcommand(interaction);
  if (!subcommand) {
    return discordMessage("Choose either `/sync run` or `/sync status`.");
  }

  if (subcommand.name === "status") {
    const run = await getLatestSyncRun(env.DB, guildId);
    if (!run) {
      return discordMessage("Hagrid has not recorded a franchise sync for this server yet.");
    }

    const counts = run.status === "SUCCESS"
      ? `\nPlayers: ${run.player_count ?? 0} · Usage rows: ${run.usage_count ?? 0} · Changes: ${run.change_count ?? 0}`
      : "";
    const error = run.error_message ? `\nError: ${run.error_message.slice(0, 1000)}` : "";
    const completed = run.completed_at ? `\nCompleted: ${run.completed_at} UTC` : "";

    return discordMessage(
      `**Latest sync: ${run.status}**\nRun: \`${run.run_id.slice(0, 8)}\`` +
        `\nStarted: ${run.started_at} UTC${completed}${counts}${error}`,
    );
  }

  if (subcommand.name !== "run") {
    return discordMessage("Unknown sync subcommand.");
  }

  const userId = invokerId(interaction);
  if (!userId) {
    return discordMessage("I could not identify the user starting this sync.");
  }

  if (!interaction.application_id || !interaction.token) {
    return discordMessage("This Discord interaction cannot be deferred safely. Please try again.");
  }

  ctx.waitUntil(runAndRespond(interaction, env, guildId, userId));
  return discordDeferred();
}
