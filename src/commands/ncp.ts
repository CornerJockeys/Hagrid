import {getGuildConfig} from "../db";
import {discordMessage, discordUpdateMessage} from "../discord";
import type {DiscordInteraction, Env} from "../types";
import type {TeamDivision} from "../league/view";

const DIVISIONS: TeamDivision[] = ["FL", "AL", "CL", "ML"];

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function selectedValue(interaction: DiscordInteraction): string | null {
  const value = interaction.data?.values?.[0];
  return typeof value === "string" && value ? value : null;
}

async function isAgmPlus(env: Env, guildId: string, discordId: string): Promise<boolean> {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return false;
  const result = await env.DB.prepare(
    `SELECT staff_position, slot
     FROM league_players_current
     WHERE LOWER(franchise_name) = LOWER(?) AND discord_id = ?`,
  ).bind(config.franchise_name, discordId).all<{staff_position: string | null; slot: string | null}>();

  return result.results.some(row => {
    const value = `${row.staff_position ?? ""} ${row.slot ?? ""}`.trim().toLocaleUpperCase("en-US");
    return /(^|\b)(AGM|GM|FM)(\b|$)/.test(value) ||
      value.includes("ASSISTANT GENERAL MANAGER") ||
      value.includes("GENERAL MANAGER") ||
      value.includes("FRANCHISE MANAGER");
  });
}

function actionComponents(userId: string): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `ncp:action:${userId}`,
      placeholder: "Choose an NCP action",
      min_values: 1,
      max_values: 1,
      options: [
        {label: "Submit NCP", value: "submit", description: "Record an NCP against usage and playoff eligibility"},
        {label: "Dummy / Demo", value: "dummy", description: "Preview the NCP flow without saving anything"},
      ],
    }],
  }];
}

function divisionComponents(userId: string, dummy: boolean): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `ncp:division:${userId}:${dummy ? "dummy" : "submit"}`,
      placeholder: "Choose a division",
      min_values: 1,
      max_values: 1,
      options: DIVISIONS.map(value => ({
        label: value,
        value,
      })),
    }],
  }];
}

function modeComponents(userId: string, division: TeamDivision, dummy: boolean): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `ncp:mode:${userId}:${dummy ? "dummy" : "submit"}:${division}`,
      placeholder: "Choose a mode",
      min_values: 1,
      max_values: 1,
      options: [
        {label: "Doubles (2s)", value: "2s"},
        {label: "Standard (3s)", value: "3s"},
      ],
    }],
  }];
}

function dummyPreview(division: TeamDivision, mode: string): string {
  const slots = mode === "2s" ? "B, E" : "B, E, H";
  return [
    `**[DUMMY] NCP Preview — ${division} · ${mode}**`,
    "",
    "Match: **Match Week 4 — Wizards vs Example Opponent**",
    `Slots charged: **${slots}**`,
    "",
    "**Usage effect**",
    "Slot B: +1 series use",
    "Slot E: +1 series use",
    ...(mode === "3s" ? ["Slot H: +1 series use"] : []),
    "",
    "**Playoff eligibility effect**",
    "Games from this NCP do **not** count toward the 15-game playoff requirement.",
    "",
    "_Dummy only — no NCP is saved and no usage is changed._",
  ].join("\n");
}

export async function handleNcpCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("NCP management can only be used inside a Discord server channel.");
  }
  const userId = invokerId(interaction);
  if (!userId) return discordMessage("Hagrid could not identify your Discord account.");
  if (!(await isAgmPlus(env, interaction.guild_id, userId))) {
    return discordMessage("Only AGM, GM, or FM staff can submit or preview NCPs.");
  }

  return discordMessage(
    "**NCP management**\nChoose whether to submit an NCP or preview the flow.",
    true,
    actionComponents(userId),
  );
}

export async function handleNcpComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id) return discordMessage("That NCP control is no longer valid.");
  const parts = (interaction.data?.custom_id ?? "").split(":");
  if (parts[0] !== "ncp") return discordMessage("That NCP control is no longer valid.");

  const userId = parts[2];
  const actorId = invokerId(interaction);
  if (!actorId || actorId !== userId) {
    return discordMessage("Only the AGM+ staff member who started this flow can continue it.");
  }
  if (!(await isAgmPlus(env, interaction.guild_id, actorId))) {
    return discordMessage("You no longer have AGM+ permission for NCP management.");
  }

  if (parts[1] === "action") {
    const action = selectedValue(interaction);
    if (action !== "submit" && action !== "dummy") {
      return discordUpdateMessage("Choose Submit NCP or Dummy / Demo.", actionComponents(userId));
    }
    return discordUpdateMessage(
      action === "dummy"
        ? "**NCP dummy / demo**\nChoose a division."
        : "**Submit NCP**\nChoose a division.",
      divisionComponents(userId, action === "dummy"),
    );
  }

  if (parts[1] === "division") {
    const kind = parts[3];
    const division = selectedValue(interaction)?.toLocaleUpperCase("en-US") as TeamDivision | undefined;
    if (!division || !DIVISIONS.includes(division)) {
      return discordMessage("Choose a valid division.");
    }
    return discordUpdateMessage(
      `**${kind === "dummy" ? "NCP dummy / demo" : "Submit NCP"} — ${division}**\nChoose the mode.`,
      modeComponents(userId, division, kind === "dummy"),
    );
  }

  if (parts[1] === "mode") {
    const kind = parts[3];
    const division = parts[4] as TeamDivision;
    const mode = selectedValue(interaction);
    if (!DIVISIONS.includes(division) || (mode !== "2s" && mode !== "3s")) {
      return discordMessage("That NCP selection is no longer valid.");
    }

    if (kind === "dummy") {
      return discordUpdateMessage(dummyPreview(division, mode), []);
    }

    return discordUpdateMessage(
      [
        `**Submit NCP — ${division} · ${mode}**`,
        "",
        "The live match picker is deferred until the Season 20 matches/fixtures adapter is wired.",
        "Once enabled, this step will show the selected franchise's S20 matches, then ask for 2 slots in 2s or 3 slots in 3s and display the usage/playoff-eligibility changes before confirmation.",
      ].join("\n"),
      [],
    );
  }

  return discordMessage("That NCP control is no longer valid.");
}
