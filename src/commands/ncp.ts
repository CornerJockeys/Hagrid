import {getCachedGuildConfig} from "../config-cache";
import {discordMessage, discordUpdateMessage, sendDiscordThreadMessage} from "../discord";
import {captainDivisions, hasAgmPlusRole, hasCaptainPlusRole, hasCaptainRole} from "../discord-roles";
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

function availableDivisions(interaction: DiscordInteraction): TeamDivision[] {
  if (hasAgmPlusRole(interaction)) return DIVISIONS;
  if (hasCaptainRole(interaction)) return captainDivisions(interaction);
  return [];
}

function canUseDivision(interaction: DiscordInteraction, division: TeamDivision): boolean {
  return availableDivisions(interaction).includes(division);
}

interface NcpStoredPlayer {
  sprocketPlayerId: string;
  memberId: string | null;
  discordId: string | null;
  name: string;
  slot: string;
}

interface NcpRecordRow {
  interaction_id: string;
  guild_id: string;
  franchise_name: string;
  season_number: number;
  division: string;
  mode: string;
  players_json: string;
  slots_json: string;
  created_by_discord_id: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by_discord_id: string | null;
  reviewed_at: string | null;
}

function parseStoredPlayers(record: NcpRecordRow): NcpStoredPlayer[] {
  try {
    const value = JSON.parse(record.players_json) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((player): player is NcpStoredPlayer =>
      Boolean(
        player &&
        typeof player === "object" &&
        typeof (player as NcpStoredPlayer).name === "string" &&
        typeof (player as NcpStoredPlayer).slot === "string",
      ),
    );
  } catch {
    return [];
  }
}

function divisionComponents(
  userId: string,
  dummy: boolean,
  divisions: TeamDivision[],
): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `ncp:division:${userId}:${dummy ? "dummy" : "submit"}`,
      placeholder: "Choose a division",
      min_values: 1,
      max_values: 1,
      options: divisions.map(value => ({
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
    dummy ? "**Players charged (demo)**" : "**Players requested**",
    ...players.map(player => `Slot ${slotLabel(player.slot)} — **${player.name}**`),
    "",
    dummy ? "**Usage effect (demo)**" : "**Usage effect if approved**",
    ...players.map(player => `Slot ${slotLabel(player.slot)}: +1 series use`),
    "",
    "**Playoff eligibility effect**",
    "Games from this NCP do **not** count toward the 15-game playoff requirement.",
  ];
  if (dummy) lines.push("", "_Dummy only — no NCP is saved or posted._");
  return lines.join("\n");
}

function approvalComponents(requestId: string): unknown[] {
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: "Approve NCP",
        custom_id: `ncp:review:${requestId}:approve`,
      },
      {
        type: 2,
        style: 4,
        label: "Reject NCP",
        custom_id: `ncp:review:${requestId}:reject`,
      },
    ],
  }];
}

function pendingSummary(
  franchise: string,
  division: TeamDivision,
  mode: "2s" | "3s",
  players: FranchisePlayer[],
  actorId: string,
): string {
  return [
    `**NCP Pending AGM+ Approval — ${franchise} · ${division} · ${mode}**`,
    "",
    "**Players / slots requested**",
    ...players.map(player => `• Slot ${slotLabel(player.slot)} — ${player.name}`),
    "",
    "If approved: **1 series use is charged to each listed slot.**",
    "Playoff eligibility games: **No — NCP games are excluded.**",
    `Requested by: <@${actorId}>`,
    "",
    "**AGM+ review required:** approve or reject this request below.",
  ].join("\n");
}

function reviewedSummary(
  record: NcpRecordRow,
  status: "approved" | "rejected",
  reviewerId: string,
): string {
  const players = parseStoredPlayers(record);
  const approved = status === "approved";
  return [
    `**NCP ${approved ? "Approved" : "Rejected"} — ${record.franchise_name} · ${record.division} · ${record.mode}**`,
    "",
    "**Players / slots requested**",
    ...(players.length > 0
      ? players.map(player => `• Slot ${player.slot} — ${player.name}`)
      : ["• Stored player detail could not be read."]),
    "",
    approved
      ? "Usage consumed: **Yes — 1 series use per listed slot.**"
      : "Usage consumed: **No — rejected requests do not affect usage.**",
    "Playoff eligibility games: **No — NCP games are excluded.**",
    `Requested by: <@${record.created_by_discord_id}>`,
    `${approved ? "Approved" : "Rejected"} by: <@${reviewerId}>`,
  ].join("\n");
}

async function handleNcpReview(
  interaction: DiscordInteraction,
  env: Env,
  requestId: string,
  decision: string,
): Promise<Response> {
  if (!interaction.guild_id) {
    return discordMessage("NCP approval can only be completed inside the configured Discord server.");
  }
  const reviewerId = invokerId(interaction);
  if (!reviewerId) return discordMessage("Hagrid could not identify your Discord account.");
  if (!hasAgmPlusRole(interaction)) {
    return discordMessage("Only AGM, GM, or FM staff can approve or reject an NCP.");
  }
  if (interaction.channel_id !== NCP_THREAD_ID) {
    return discordMessage("NCP approval must be completed from the configured NCP thread.");
  }
  if (decision !== "approve" && decision !== "reject") {
    return discordMessage("That NCP review action is no longer valid.");
  }

  const record = await env.DB.prepare(
    `SELECT interaction_id, guild_id, franchise_name, season_number, division, mode,
            players_json, slots_json, created_by_discord_id, created_at, status,
            reviewed_by_discord_id, reviewed_at
     FROM ncp_records
     WHERE interaction_id = ? AND guild_id = ?`,
  ).bind(requestId, interaction.guild_id).first<NcpRecordRow>();

  if (!record) {
    return discordMessage("Hagrid could not find that pending NCP request.");
  }

  const config = await getCachedGuildConfig(env, interaction.guild_id);
  if (!config || config.franchise_name.trim().toLocaleLowerCase("en-US") !== record.franchise_name.trim().toLocaleLowerCase("en-US")) {
    return discordMessage("That NCP request is not tied to this server's currently configured franchise.");
  }

  if (record.status !== "pending") {
    return discordMessage(
      `That NCP was already ${record.status}${record.reviewed_by_discord_id ? ` by <@${record.reviewed_by_discord_id}>` : ""}.`,
    );
  }

  const nextStatus = decision === "approve" ? "approved" : "rejected";
  const update = await env.DB.prepare(
    `UPDATE ncp_records
     SET status = ?, reviewed_by_discord_id = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE interaction_id = ? AND guild_id = ? AND status = 'pending'`,
  ).bind(nextStatus, reviewerId, requestId, interaction.guild_id).run();
  if (!update.success) {
    return discordMessage("Hagrid could not save that NCP review.");
  }

  const reviewed = await env.DB.prepare(
    `SELECT interaction_id, guild_id, franchise_name, season_number, division, mode,
            players_json, slots_json, created_by_discord_id, created_at, status,
            reviewed_by_discord_id, reviewed_at
     FROM ncp_records
     WHERE interaction_id = ? AND guild_id = ?`,
  ).bind(requestId, interaction.guild_id).first<NcpRecordRow>();

  if (
    !reviewed ||
    reviewed.status !== nextStatus ||
    reviewed.reviewed_by_discord_id !== reviewerId
  ) {
    return discordMessage("That NCP was reviewed by someone else before this action completed.");
  }

  return discordUpdateMessage(
    reviewedSummary(reviewed, nextStatus, reviewerId),
    [],
  );
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
  const divisions = availableDivisions(interaction);
  if (!hasCaptainPlusRole(interaction) || divisions.length === 0) {
    return discordMessage("Only current franchise Captain+ staff can preview NCP workflows.");
  }

  return discordMessage(
    "**NCP dummy / demo**\nChoose a division. Nothing will be saved or changed.",
    true,
    divisionComponents(userId, true, divisions),
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
  const divisions = availableDivisions(interaction);
  if (!hasCaptainPlusRole(interaction) || divisions.length === 0) {
    return discordMessage("Only current franchise Captain+ staff can submit NCPs.");
  }

  return discordMessage(
    "**Submit NCP**\nChoose a division. Every NCP submission requires AGM+ approval in the NCP thread.",
    true,
    divisionComponents(userId, false, divisions),
  );
}

export async function handleNcpComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id) return discordMessage("That NCP control is no longer valid.");
  const parts = (interaction.data?.custom_id ?? "").split(":");
  if (parts[0] !== "ncp") return discordMessage("That NCP control is no longer valid.");

  if (parts[1] === "review") {
    return handleNcpReview(interaction, env, parts[2] ?? "", parts[3] ?? "");
  }

  const userId = parts[2];
  const actorId = invokerId(interaction);
  if (!actorId || actorId !== userId) {
    return discordMessage("Only the Captain+ staff member who started this flow can continue it.");
  }
  if (!hasCaptainPlusRole(interaction)) {
    return discordMessage("You no longer have Captain+ permission for NCP management.");
  }

  if (parts[1] === "division") {
    const kind = parts[3];
    const division = selectedValue(interaction)?.toLocaleUpperCase("en-US") as TeamDivision | undefined;
    if (!division || !DIVISIONS.includes(division) || !canUseDivision(interaction, division)) {
      return discordMessage("Choose a division you are authorized to manage.");
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
    if (
      !["dummy", "submit"].includes(kind) ||
      !DIVISIONS.includes(division) ||
      !canUseDivision(interaction, division) ||
      (mode !== "2s" && mode !== "3s")
    ) {
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
    if (
      !["dummy", "submit"].includes(kind) ||
      !DIVISIONS.includes(division) ||
      !canUseDivision(interaction, division) ||
      (mode !== "2s" && mode !== "3s")
    ) {
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
    if (
      !["dummy", "submit"].includes(kind) ||
      !DIVISIONS.includes(division) ||
      !canUseDivision(interaction, division) ||
      (mode !== "2s" && mode !== "3s")
    ) {
      return discordMessage("That NCP confirmation is no longer valid.");
    }

    const config = await getCachedGuildConfig(env, interaction.guild_id);
    if (!config) return discordMessage("No franchise is configured for this Discord server.");
    const roster = await getCurrentCompetitiveFranchiseRoster(env, interaction.guild_id);
    const selected = resolveSelectedPlayers(roster, division, mode, ids);
    if (!selected) {
      return discordUpdateMessage("The selected roster changed before confirmation. Start the NCP flow again.", []);
    }
    const configuredFranchise = config.franchise_name.trim().toLocaleLowerCase("en-US");
    if (selected.some(player => player.franchise.trim().toLocaleLowerCase("en-US") !== configuredFranchise)) {
      return discordUpdateMessage("NCPs can only include players from this server's configured franchise.", []);
    }

    if (kind === "dummy") {
      return discordUpdateMessage(
        playerReview(config.franchise_name, division, mode, selected, true) +
          "\n\n✅ Demo completed. Nothing was saved or posted.",
        [],
      );
    }

    const requestId = interaction.id ?? crypto.randomUUID();
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
         slots_json, created_by_discord_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).bind(
      requestId,
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
      return discordUpdateMessage("Hagrid could not save that NCP request. Nothing was posted.", []);
    }

    try {
      await sendDiscordThreadMessage(
        env,
        NCP_THREAD_ID,
        pendingSummary(config.franchise_name, division, mode, selected, actorId),
        approvalComponents(requestId),
      );
    } catch (error) {
      await env.DB.prepare(
        "DELETE FROM ncp_records WHERE interaction_id = ? AND guild_id = ? AND status = 'pending'",
      ).bind(requestId, interaction.guild_id).run();

      const detail = error instanceof Error ? error.message : String(error);
      console.error("Pending NCP could not be posted for AGM+ review.", error);
      return discordUpdateMessage(
        `Hagrid could not post that NCP for AGM+ approval, so the pending request was cancelled.\n\nError: \`${detail.slice(0, 900)}\``,
        [],
      );
    }

    return discordUpdateMessage(
      `✅ NCP submitted for **${config.franchise_name} ${division} ${mode}**. It will not affect usage until AGM+ approves it in <#${NCP_THREAD_ID}>.`,
      [],
    );
  }

  return discordMessage("That NCP control is no longer valid.");
}
