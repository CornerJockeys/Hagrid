import {getGuildConfig} from "../db";
import {discordMessage, discordUpdateMessage} from "../discord";
import {getLeagueTeamPlayers} from "../league/db";
import {isCompetitiveSlot, slotLabel, teamDivision, type TeamDivision} from "../league/view";
import {easternDate, parseReminderDate} from "../reminders/logic";
import type {DiscordInteraction, Env} from "../types";

const DIVISIONS: TeamDivision[] = ["FL", "AL", "CL", "ML"];
const CADENCES = new Set(["normal", "daily", "once"]);

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function selectedValue(interaction: DiscordInteraction): string | null {
  const value = interaction.data?.values?.[0];
  return typeof value === "string" && value ? value : null;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function decode(value: string): string {
  return decodeURIComponent(value);
}

function parseCustomId(customId: string): string[] {
  return customId.split(":");
}

function staffLabel(row: {staff_position: string | null; slot: string | null}): string {
  return `${row.staff_position ?? ""} ${row.slot ?? ""}`.trim().toLocaleUpperCase("en-US");
}

async function isAuthorizedReminderStaff(env: Env, guildId: string, discordId: string): Promise<boolean> {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return false;
  const result = await env.DB.prepare(
    `SELECT staff_position, slot
     FROM league_players_current
     WHERE LOWER(franchise_name) = LOWER(?) AND discord_id = ?`,
  ).bind(config.franchise_name, discordId).all<{staff_position: string | null; slot: string | null}>();

  return result.results.some(row => {
    const value = staffLabel(row);
    return /(^|\b)(FM|AGM|GM|CAPT|CAPTAIN)(\b|$)/.test(value) ||
      value.includes("FRANCHISE MANAGER") ||
      value.includes("ASSISTANT GENERAL MANAGER") ||
      value.includes("GENERAL MANAGER");
  });
}

function divisionComponents(creatorId: string): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `remind:division:${creatorId}`,
      placeholder: "Choose a division",
      min_values: 1,
      max_values: 1,
      options: DIVISIONS.map(value => ({
        label: value,
        value,
        description: ({
          FL: "Foundation League",
          AL: "Academy League",
          CL: "Champion League",
          ML: "Master League",
        } as Record<TeamDivision, string>)[value],
      })),
    }],
  }];
}

function playerComponents(
  creatorId: string,
  division: TeamDivision,
  players: Array<{sprocket_player_id: string; name: string; slot: string | null}>,
): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `remind:player:${creatorId}:${division}`,
      placeholder: "Choose a player",
      min_values: 1,
      max_values: 1,
      options: players.slice(0, 25).map(player => ({
        label: player.name.slice(0, 100),
        value: player.sprocket_player_id,
        description: `Slot ${slotLabel(player.slot)}`.slice(0, 100),
      })),
    }],
  }];
}

function cadenceComponents(
  creatorId: string,
  division: TeamDivision,
  playerId: string,
  dueDate: string,
): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `remind:cadence:${creatorId}:${division}:${encode(playerId)}:${dueDate}`,
      placeholder: "Choose reminder frequency",
      min_values: 1,
      max_values: 1,
      options: [
        {label: "Normal", value: "normal", description: "Every 2 days, anchored to the deadline"},
        {label: "Daily", value: "daily", description: "Every day through the deadline"},
        {label: "Once", value: "once", description: "Only on the deadline"},
      ],
    }],
  }];
}

function dateModal(
  creatorId: string,
  division: TeamDivision,
  playerId: string,
): Response {
  return Response.json({
    type: 9,
    data: {
      custom_id: `remind:date:${creatorId}:${division}:${encode(playerId)}`,
      title: "Before what date?",
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: "before",
          label: "Before what date?",
          style: 1,
          placeholder: "mm/dd/yy",
          required: true,
          min_length: 6,
          max_length: 10,
        }],
      }],
    },
  });
}

function modalInput(interaction: DiscordInteraction, customId: string): string | null {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId && typeof component.value === "string") {
        return component.value;
      }
    }
  }
  return null;
}

async function resolvePlayer(
  env: Env,
  guildId: string,
  division: TeamDivision,
  playerId: string,
) {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return {config: null, player: null};
  const players = await getLeagueTeamPlayers(env.DB, config.franchise_name);
  const player = players.find(value =>
    value.sprocket_player_id === playerId &&
    isCompetitiveSlot(value.slot) &&
    teamDivision(value.skill_group) === division
  ) ?? null;
  return {config, player};
}

export async function handleRemindCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Reminders can only be created inside a Discord server channel.");
  }

  const creatorId = invokerId(interaction);
  if (!creatorId) return discordMessage("Hagrid could not identify who created this reminder.");
  if (!(await isAuthorizedReminderStaff(env, interaction.guild_id, creatorId))) {
    return discordMessage("Only the franchise Captain, AGM, GM, or FM can create player reminders.");
  }

  return discordMessage(
    "**Create reminder**\nChoose the player's division.",
    true,
    divisionComponents(creatorId),
  );
}

export async function handleRemindComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const customId = interaction.data?.custom_id ?? "";
  const parts = parseCustomId(customId);
  if (parts[0] !== "remind" || !interaction.guild_id || !interaction.channel_id) {
    return discordMessage("That reminder control is no longer valid.");
  }

  const creatorId = parts[2];
  const actorId = invokerId(interaction);
  if (!actorId || actorId !== creatorId) {
    return discordMessage("Only the staff member who started this reminder can continue it.");
  }
  if (!(await isAuthorizedReminderStaff(env, interaction.guild_id, actorId))) {
    return discordMessage("You no longer have permission to create player reminders.");
  }

  if (parts[1] === "division") {
    const division = selectedValue(interaction)?.toLocaleUpperCase("en-US") as TeamDivision | undefined;
    if (!division || !DIVISIONS.includes(division)) {
      return discordUpdateMessage("Choose a valid division.", divisionComponents(creatorId));
    }

    const config = await getGuildConfig(env.DB, interaction.guild_id);
    if (!config) return discordUpdateMessage("No franchise is configured for this Discord server.");

    const players = (await getLeagueTeamPlayers(env.DB, config.franchise_name))
      .filter(player => isCompetitiveSlot(player.slot) && teamDivision(player.skill_group) === division)
      .sort((a, b) =>
        slotLabel(a.slot).localeCompare(slotLabel(b.slot), "en-US", {numeric: true}) ||
        a.name.localeCompare(b.name),
      );

    if (players.length === 0) {
      return discordUpdateMessage(`No current competitive ${division} players were found for ${config.franchise_name}.`);
    }

    return discordUpdateMessage(
      `**Create reminder — ${division}**\nChoose the player.`,
      playerComponents(creatorId, division, players),
    );
  }

  if (parts[1] === "player") {
    const division = parts[3] as TeamDivision;
    const playerId = selectedValue(interaction);
    if (!DIVISIONS.includes(division) || !playerId) {
      return discordMessage("That player selection is no longer valid.");
    }

    const resolved = await resolvePlayer(env, interaction.guild_id, division, playerId);
    if (!resolved.player) return discordMessage("That player is no longer on the selected divisional roster.");
    if (!resolved.player.discord_id) {
      return discordMessage(`${resolved.player.name} does not have a linked Discord ID, so Hagrid cannot ping them.`);
    }

    return dateModal(creatorId, division, playerId);
  }

  if (parts[1] === "cadence") {
    const division = parts[3] as TeamDivision;
    const playerId = decode(parts[4] ?? "");
    const dueDate = parts[5] ?? "";
    const cadence = selectedValue(interaction);
    if (!DIVISIONS.includes(division) || !playerId || !dueDate || !cadence || !CADENCES.has(cadence)) {
      return discordMessage("That reminder selection is no longer valid.");
    }

    const resolved = await resolvePlayer(env, interaction.guild_id, division, playerId);
    if (!resolved.config || !resolved.player?.discord_id) {
      return discordMessage("That player is no longer available for this reminder.");
    }

    const result = await env.DB.prepare(
      `INSERT INTO scrim_reminders (
         guild_id, channel_id, franchise_name, sprocket_player_id, player_discord_id,
         player_name, division, due_date, cadence, created_by_discord_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      interaction.guild_id,
      interaction.channel_id,
      resolved.config.franchise_name,
      resolved.player.sprocket_player_id,
      resolved.player.discord_id,
      resolved.player.name,
      division,
      dueDate,
      cadence,
      creatorId,
    ).run();

    if (!result.success) return discordMessage("Hagrid could not save that reminder.");

    const cadenceText = cadence === "normal"
      ? "Normal — every 2 days, anchored to the deadline"
      : cadence === "daily"
        ? "Daily"
        : "Once — on the deadline";

    return discordUpdateMessage(
      `✅ Reminder created for <@${resolved.player.discord_id}>.\n**${division} · ${resolved.player.name}**\nBefore **${dueDate}** · **${cadenceText}**`,
      [],
    );
  }

  return discordMessage("That reminder control is no longer valid.");
}

export async function handleRemindModal(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const customId = interaction.data?.custom_id ?? "";
  const parts = parseCustomId(customId);
  if (parts[0] !== "remind" || parts[1] !== "date" || !interaction.guild_id) {
    return discordMessage("That reminder form is no longer valid.");
  }

  const creatorId = parts[2];
  const division = parts[3] as TeamDivision;
  const playerId = decode(parts[4] ?? "");
  const actorId = invokerId(interaction);
  if (!actorId || actorId !== creatorId) {
    return discordMessage("Only the staff member who started this reminder can continue it.");
  }
  if (!(await isAuthorizedReminderStaff(env, interaction.guild_id, actorId))) {
    return discordMessage("You no longer have permission to create player reminders.");
  }

  const rawDate = modalInput(interaction, "before");
  const dueDate = rawDate ? parseReminderDate(rawDate) : null;
  if (!dueDate) {
    return discordMessage("That date is not valid. Run `/remind` again and enter it as `mm/dd/yy`.");
  }
  if (dueDate < easternDate()) {
    return discordMessage("The reminder date cannot be in the past. Run `/remind` again.");
  }

  const resolved = await resolvePlayer(env, interaction.guild_id, division, playerId);
  if (!resolved.player) return discordMessage("That player is no longer on the selected divisional roster.");

  return discordMessage(
    `**Create reminder — ${division} · ${resolved.player.name}**\nBefore **${dueDate}**. How often should Hagrid remind them?`,
    true,
    cadenceComponents(creatorId, division, playerId, dueDate),
  );
}
