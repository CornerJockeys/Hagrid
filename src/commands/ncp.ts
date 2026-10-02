import {getGuildConfig} from "../db";
import {discordMessage, discordUpdateMessage} from "../discord";
import type {DiscordInteraction, Env} from "../types";
import type {TeamDivision} from "../league/view";
import {recordSimulatedWrite} from "../testing/simulated-write";

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

export async function handleNcpDummyCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("NCP demos can only be used inside a Discord server channel.");
  }
  const userId = invokerId(interaction);
  if (!userId) return discordMessage("Hagrid could not identify your Discord account.");
  if (!(await isAgmPlus(env, interaction.guild_id, userId))) {
    return discordMessage("Only AGM, GM, or FM staff can preview NCP workflows.");
  }

  return discordMessage(
    "**NCP dummy / demo**\nChoose a division. Nothing will be saved or changed.",
    true,
    divisionComponents(userId, true),
  );
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
    "**Submit NCP**\nChoose a division.",
    true,
    divisionComponents(userId, false),
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
      const slots = mode === "2s" ? ["B", "E"] : ["B", "E", "H"];
      await recordSimulatedWrite(env, {
        guildId: interaction.guild_id,
        commandName: "ncpdummy",
        operationName: "submit_ncp",
        targetName: "ncp_records",
        payload: {
          season_number: 20,
          division,
          mode,
          match_label: "Match Week 4 — Wizards vs Example Opponent",
          slots,
          usage_consumed: true,
          playoff_eligibility_games_counted: false,
          status: "simulated",
        },
        createdByDiscordId: actorId,
      });

      return discordUpdateMessage(
        dummyPreview(division, mode) + "\n\n✅ **Simulated NCP write recorded.** No production NCP or usage state was changed.",
        [],
      );
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
