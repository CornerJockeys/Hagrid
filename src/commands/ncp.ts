import {getCachedGuildConfig} from "../config-cache";
import {discordMessage, discordUpdateMessage, sendDiscordThreadMessage} from "../discord";
import {hasAgmPlusRole} from "../discord-roles";
import type {DiscordInteraction, Env} from "../types";
import {slotLabel, teamDivision, type TeamDivision} from "../league/view";
import type {FranchisePlayer} from "../sprocket/players";
import {getCurrentCompetitiveFranchiseRoster} from "../activity/roster";
import {CURRENT_MLE_SEASON} from "../season-policy";

const DIVISIONS: TeamDivision[] = ["FL", "AL", "CL", "ML"];
const NCP_THREAD_ID = "1553513630333665461";

function invokerId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function selectedValue(interaction: DiscordInteraction): string | null {
  const value = interaction.data?.values?.[0];
  return typeof value === "string" && value ? value : null;
}

function selectedValues(interaction: DiscordInteraction): string[] {
  return (interaction.data?.values ?? [])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function requiredPlayers(mode: string): 2 | 3 {
  return mode === "3s" ? 3 : 2;
}
function isAgmPlus(interaction: DiscordInteraction): boolean {
  return hasAgmPlusRole(interaction);
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


function playerComponents(
  userId: string,
  kind: "dummy" | "submit",
  division: TeamDivision,
  mode: "2s" | "3s",
  players: FranchisePlayer[],
): unknown[] {
  const count = requiredPlayers(mode);
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `ncp:players:${userId}:${kind}:${division}:${mode}`,
      placeholder: `Choose ${count} players`,
      min_values: count,
      max_values: count,
      options: players.slice(0, 25).map(player => ({
        label: `${slotLabel(player.slot)} · ${player.name}`.slice(0, 100),
        value: player.sprocketPlayerId,
        description: `${division} roster slot ${slotLabel(player.slot)}`.slice(0, 100),
      })),
    }],
  }];
}

function confirmationComponents(
  userId: string,
  kind: "dummy" | "submit",
  division: TeamDivision,
  mode: "2s" | "3s",
  playerIds: string[],
): unknown[] {
  const encoded = playerIds.join(",");
  return [{
    type: 1,
    components: [
      {type: 2, style: 3, label: kind === "dummy" ? "Finish Demo" : "Confirm NCP", custom_id: `ncp:confirm:${userId}:${kind}:${division}:${mode}:${encoded}`},
      {type: 2, style: 4, label: "Cancel", custom_id: `ncp:cancel:${userId}`},
    ],
  }];
}

function rosterForDivision(players: FranchisePlayer[], division: TeamDivision): FranchisePlayer[] {
  return players
    .filter(player => teamDivision(player.skillGroup) === division)
    .sort((a, b) =>
      slotLabel(a.slot).localeCompare(slotLabel(b.slot), "en-US", {numeric: true}) ||
      a.name.localeCompare(b.name),
    );
}

function resolveSelectedPlayers(
  roster: FranchisePlayer[],
  division: TeamDivision,
  mode: "2s" | "3s",
  ids: string[],
): FranchisePlayer[] | null {
  const unique = [...new Set(ids)];
  if (unique.length !== requiredPlayers(mode)) return null;
  const allowed = rosterForDivision(roster, division);
  const selected = unique
    .map(id => allowed.find(player => player.sprocketPlayerId === id) ?? null)
    .filter((player): player is FranchisePlayer => player !== null);
  return selected.length === unique.length ? selected : null;
}

function playerReview(
  franchise: string,
  division: TeamDivision,
  mode: "2s" | "3s",
  players: FranchisePlayer[],
  dummy: boolean,
): string {
  const lines = [
    `**${dummy ? "[DUMMY] " : ""}NCP Review — ${franchise} · ${division} · ${mode}**`,
    "",
    "**Players charged**",
    ...players.map(player => `Slot ${slotLabel(player.slot)} — **${player.name}**`),
    "",
    "**Usage effect**",
    ...players.map(player => `Slot ${slotLabel(player.slot)}: +1 series use`),
    "",
    "**Playoff eligibility effect**",
    "Games from this NCP do **not** count toward the 15-game playoff requirement.",
  ];
  if (dummy) lines.push("", "_Dummy only — no NCP is saved or posted._");
  return lines.join("\n");
}

function postedSummary(
  franchise: string,
  division: TeamDivision,
  mode: "2s" | "3s",
  players: FranchisePlayer[],
  actorId: string,
): string {
  return [
    `**NCP Recorded — ${franchise} · ${division} · ${mode}**`,
    "",
    "**Players / slots charged**",
    ...players.map(player => `• Slot ${slotLabel(player.slot)} — ${player.name}`),
    "",
    "Usage consumed: **Yes — 1 series use per listed slot**",
    "Playoff eligibility games: **No — NCP games are excluded**",
    `Recorded by: <@${actorId}>`,
  ].join("\n");
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
  if (!isAgmPlus(interaction)) {
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
  if (!isAgmPlus(interaction)) {
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
  if (!isAgmPlus(interaction)) {
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

  if (parts[1] === "cancel") {
    return discordUpdateMessage("NCP submission cancelled.", []);
  }

  if (parts[1] === "mode") {
    const kind = parts[3] as "dummy" | "submit";
    const division = parts[4] as TeamDivision;
    const mode = selectedValue(interaction) as "2s" | "3s" | null;
    if (!["dummy", "submit"].includes(kind) || !DIVISIONS.includes(division) || (mode !== "2s" && mode !== "3s")) {
      return discordMessage("That NCP selection is no longer valid.");
    }

    const roster = rosterForDivision(
      await getCurrentCompetitiveFranchiseRoster(env, interaction.guild_id),
      division,
    );
    const count = requiredPlayers(mode);
    if (roster.length < count) {
      return discordUpdateMessage(
        `Hagrid found only ${roster.length} current ${division} roster player${roster.length === 1 ? "" : "s"}; ${count} are required for ${mode}.`,
        [],
      );
    }

    return discordUpdateMessage(
      `**${kind === "dummy" ? "NCP dummy / demo" : "Submit NCP"} — ${division} · ${mode}**\nChoose the ${count} players who are being charged for this NCP.`,
      playerComponents(userId, kind, division, mode, roster),
    );
  }

  if (parts[1] === "players") {
    const kind = parts[3] as "dummy" | "submit";
    const division = parts[4] as TeamDivision;
    const mode = parts[5] as "2s" | "3s";
    if (!["dummy", "submit"].includes(kind) || !DIVISIONS.includes(division) || (mode !== "2s" && mode !== "3s")) {
      return discordMessage("That NCP selection is no longer valid.");
    }

    const config = await getCachedGuildConfig(env, interaction.guild_id);
    if (!config) return discordMessage("No franchise is configured for this Discord server.");
    const roster = await getCurrentCompetitiveFranchiseRoster(env, interaction.guild_id);
    const selected = resolveSelectedPlayers(roster, division, mode, selectedValues(interaction));
    if (!selected) {
      return discordMessage(`Choose exactly ${requiredPlayers(mode)} current ${division} roster players.`);
    }

    return discordUpdateMessage(
      playerReview(config.franchise_name, division, mode, selected, kind === "dummy"),
      confirmationComponents(userId, kind, division, mode, selected.map(player => player.sprocketPlayerId)),
    );
  }

  if (parts[1] === "confirm") {
    const kind = parts[3] as "dummy" | "submit";
    const division = parts[4] as TeamDivision;
    const mode = parts[5] as "2s" | "3s";
    const ids = (parts[6] ?? "").split(",").filter(Boolean);
    if (!["dummy", "submit"].includes(kind) || !DIVISIONS.includes(division) || (mode !== "2s" && mode !== "3s")) {
      return discordMessage("That NCP confirmation is no longer valid.");
    }

    const config = await getCachedGuildConfig(env, interaction.guild_id);
    if (!config) return discordMessage("No franchise is configured for this Discord server.");
    const roster = await getCurrentCompetitiveFranchiseRoster(env, interaction.guild_id);
    const selected = resolveSelectedPlayers(roster, division, mode, ids);
    if (!selected) {
      return discordUpdateMessage("The selected roster changed before confirmation. Start the NCP flow again.", []);
    }

    if (kind === "dummy") {
      return discordUpdateMessage(
        playerReview(config.franchise_name, division, mode, selected, true) +
          "\n\n✅ Demo completed. Nothing was saved or posted.",
        [],
      );
    }

    const playersJson = JSON.stringify(selected.map(player => ({
      sprocketPlayerId: player.sprocketPlayerId,
      memberId: player.memberId,
      discordId: player.discordId,
      name: player.name,
      slot: slotLabel(player.slot),
    })));
    const slotsJson = JSON.stringify(selected.map(player => slotLabel(player.slot)));
    const write = await env.DB.prepare(
      `INSERT OR IGNORE INTO ncp_records (
         interaction_id, guild_id, franchise_name, season_number, division, mode, players_json,
         slots_json, created_by_discord_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      interaction.id ?? null,
      interaction.guild_id,
      config.franchise_name,
      CURRENT_MLE_SEASON,
      division,
      mode,
      playersJson,
      slotsJson,
      actorId,
    ).run();
    if (!write.success) {
      return discordUpdateMessage("Hagrid could not save that NCP. Nothing was posted.", []);
    }

    try {
      await sendDiscordThreadMessage(
        env,
        NCP_THREAD_ID,
        postedSummary(config.franchise_name, division, mode, selected, actorId),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("NCP was saved but the NCP thread post failed.", error);
      return discordUpdateMessage(
        `✅ NCP saved, but Hagrid could not post the receipt to the NCP thread.\n\nError: \`${detail.slice(0, 900)}\``,
        [],
      );
    }

    return discordUpdateMessage(
      `✅ NCP recorded for **${config.franchise_name} ${division} ${mode}** and posted to <#${NCP_THREAD_ID}>.`,
      [],
    );
  }

  return discordMessage("That NCP control is no longer valid.");
}
