import {hasGmFmRole} from "../discord-roles";
import {discordMessage} from "../discord";
import {
  getRulebookWatchState,
  setRulebookWatchEnabled,
} from "../rulebooks/watch";
import type {DiscordCommandOption, DiscordInteraction, Env} from "../types";

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function subcommand(interaction: DiscordInteraction): DiscordCommandOption | null {
  const option = interaction.data?.options?.[0];
  return option?.type === 1 ? option : null;
}

function stateMessage(state: Awaited<ReturnType<typeof getRulebookWatchState>>): string {
  const status = state.enabled ? "Enabled" : "Paused";
  const baseline = state.lastSyncedAt ?? "Not established yet";
  const extra = state.enabled
    ? state.resumedAt
      ? `\nLast resumed: ${state.resumedAt} UTC`
      : ""
    : `\nPaused: ${state.pausedAt ?? "unknown"} UTC${state.pausedByDiscordId ? ` by <@${state.pausedByDiscordId}>` : ""}`;

  return [
    `**Rulebook Watch: ${status}**`,
    `Last known-good sync: ${baseline}`,
    `Current baseline hash: ${state.currentHash ? "\`" + state.currentHash.slice(0, 12) + "…\`" : "Not established"}`,
    extra,
  ].filter(Boolean).join("\n");
}

export async function handleRulebookWatchCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id) {
    return discordMessage("Rulebook Watch can only be managed inside the Discord server.");
  }
  if (!hasGmFmRole(interaction)) {
    return discordMessage("Only current GM or FM staff can manage Rulebook Watch.");
  }

  const actorId = invokerId(interaction);
  if (!actorId) return discordMessage("Hagrid could not identify your Discord account.");

  const option = subcommand(interaction);
  if (!option) {
    return discordMessage("Choose /rulebookwatch pause, /rulebookwatch resume, or /rulebookwatch status.");
  }

  if (option.name === "status") {
    return discordMessage(stateMessage(await getRulebookWatchState(env)));
  }

  if (option.name === "pause") {
    const current = await getRulebookWatchState(env);
    if (!current.enabled) {
      return discordMessage("Rulebook Watch is already paused. The last known-good baseline is still frozen.");
    }
    await setRulebookWatchEnabled(env, false, actorId);
    const state = await getRulebookWatchState(env);
    return discordMessage(
      `⏸️ **Rulebook Watch paused.**\nHagrid will keep serving the last known-good rulebook and will not accept, archive, or notify on source changes while paused.\n\n${stateMessage(state)}`,
    );
  }

  if (option.name === "resume") {
    const current = await getRulebookWatchState(env);
    if (current.enabled) {
      return discordMessage("Rulebook Watch is already enabled.");
    }
    await setRulebookWatchEnabled(env, true, actorId);
    const state = await getRulebookWatchState(env);
    return discordMessage(
      `▶️ **Rulebook Watch resumed.**\nThe next five-minute check will compare the live Google Doc against the frozen known-good baseline. Any accumulated real changes will produce one RULEBOOK CHANGE notification sequence.\n\n${stateMessage(state)}`,
    );
  }

  return discordMessage("Unknown Rulebook Watch subcommand.");
}
