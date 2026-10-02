import {getGuildConfig} from "../db";
import {captainDivisions, hasAgmPlusRole, hasAnyStaffRole, hasCaptainRole} from "../discord-roles";
import {discordMessage, discordUpdateMessage, sendDiscordChannelMessage} from "../discord";
import {isCompetitiveSlot, slotLabel, teamDivision, type TeamDivision} from "../league/view";
import {buildUsageAlerts} from "../reminders/usage-summary";
import {easternDate, parseReminderDate} from "../reminders/logic";
import {eligibilityNeedSteps, formatEligibilityNeed, formatShortDate, inferScrimPointAward} from "../reminders/eligibility-summary";
import {getEligibilityEvents, getLeagueEligibilityRules} from "../sprocket/eligibility-data";
import {getFranchisePlayers} from "../sprocket/players";
import {getFranchiseRoleUsagesForSeason} from "../sprocket/role-usages";
import {CURRENT_MLE_SEASON} from "../season-policy";
import type {DiscordInteraction, Env} from "../types";

const DIVISIONS: TeamDivision[] = ["FL", "AL", "CL", "ML"];
const CADENCES = new Set(["normal", "daily", "once"]);
const DIVISION_NAMES: Record<TeamDivision, string> = {FL: "Foundation League", AL: "Academy League", CL: "Champion League", ML: "Master League"};
type ReminderScope = "player" | "division" | "team" | "usage-division" | "usage-team";

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

function isAuthorizedReminderStaff(interaction: DiscordInteraction): boolean {
  return hasAnyStaffRole(interaction);
}

function availableDivisionsForReminder(interaction: DiscordInteraction): TeamDivision[] {
  if (hasAgmPlusRole(interaction)) return DIVISIONS;
  if (hasCaptainRole(interaction)) {
    const divisions = captainDivisions(interaction);
    return divisions.length > 0 ? divisions : [];
  }
  return [];
}

function scopeComponents(creatorId: string): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `remind:scope:${creatorId}`,
      placeholder: "Who should this reminder cover?",
      min_values: 1,
      max_values: 1,
      options: [
        {label: "Player", value: "player", description: "Choose one player, a date, and reminder frequency"},
        {label: "Division", value: "division", description: "Post an eligibility reminder for one division"},
        {label: "Team", value: "team", description: "Post an eligibility reminder for all divisions"},
        {label: "Usage Division", value: "usage-division", description: "Post low-usage alerts for one division"},
        {label: "Usage Team", value: "usage-team", description: "Post low-usage alerts for all divisions"},
      ],
    }],
  }];
}

function dummyComponents(creatorId: string): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `remind:dummy:${creatorId}`,
      placeholder: "Choose a reminder demo",
      min_values: 1,
      max_values: 1,
      options: [
        {label: "Player", value: "player", description: "Preview a single-player reminder"},
        {label: "Division Eligibility", value: "division", description: "Preview a division eligibility dump"},
        {label: "Team Eligibility", value: "team", description: "Preview all-division eligibility dumps"},
        {label: "Usage Division", value: "usage-division", description: "Preview a division usage reminder"},
        {label: "Usage Team", value: "usage-team", description: "Preview all-division usage reminders"},
      ],
    }],
  }];
}

function dummyReminderText(kind: string): string {
  if (kind === "player") {
    return [
      "**[DUMMY] Player Reminder**",
      "",
      "@ExamplePlayer",
      "",
      "Reminder: You have an eligibility deadline coming up on **10/24/26**.",
      "Cadence: **Normal — every 2 days at 1:30 PM ET, plus the target date**",
      "",
      "_Example only — nobody is pinged and no reminder is saved._",
    ].join("\n");
  }

  if (kind === "division") {
    return [
      "**[DUMMY] Wizards Champion League Eligibility Reminder**",
      "",
      "Target date: **10/24/26**",
      "",
      "@SlotAPlayer needs 2 scrims by **10/19/26** to be eligible by 10/24/26. 3 scrims if not done by **10/21/26**.*",
      "@SlotCPlayer needs 1 scrim by **10/19/26**.",
      "@SlotFPlayer needs 5 scrims by **10/19/26**.",
      "",
      "*The difference is due to scrim point decay and being eligible on Monday of match week vs match time.",
      "",
      "_Example only — nobody is pinged._",
    ].join("\n");
  }

  if (kind === "team") {
    return [
      "**[DUMMY] Wizards Team Eligibility Reminder**",
      "",
      "**Foundation League — Target date: 10/24/26**",
      "@FLSlotB needs 1 scrim by **10/19/26**.",
      "",
      "**Academy League — Target date: 10/24/26**",
      "@ALSlotD needs 2 scrims by **10/19/26**. 3 scrims if not done by **10/22/26**.*",
      "",
      "**Champion League — Target date: 10/24/26**",
      "@CLSlotA needs 2 scrims by **10/19/26**.",
      "@CLSlotF needs 5 scrims by **10/19/26**.",
      "",
      "**Master League — Target date: 10/24/26**",
      "✅ No current roster player is projected to need additional scrims.",
      "",
      "*The difference is due to scrim point decay and being eligible on Monday of match week vs match time.",
      "",
      "_Example only — nobody is pinged._",
    ].join("\n");
  }

  if (kind === "usage-division") {
    return [
      "**[DUMMY] Wizards Master League Usage Reminder**",
      "",
      "@ExampleMLCaptain",
      "",
      "**SlotBPlayer** has 1 remaining use in 2s. 3 uses overall.",
      "**SlotCPlayer** needs 1 full match (5 games) to become playoff eligible. *(deferred until match/NCP tracking is wired)*",
      "**SlotDPlayer** has 2 uses left in 3s.",
      "**SlotEPlayer** has no remaining uses in 2s. 2 uses left in 3s.",
      "**SlotHPlayer** has no remaining uses.",
      "",
      "_Example only — nobody is pinged._",
    ].join("\n");
  }

  return [
    "**[DUMMY] Wizards Team Usage Reminder**",
    "",
    "**Foundation League**",
    "@ExampleFLCaptain",
    "**FLSlotC** has 2 uses left in 3s.",
    "",
    "**Academy League**",
    "@ExampleALCaptain",
    "**ALSlotB** has 1 remaining use in 2s. 3 uses overall.",
    "",
    "**Champion League**",
    "@ExampleCLCaptain",
    "✅ No roster slot is currently below the usage-warning thresholds.",
    "",
    "**Master League**",
    "@ExampleMLCaptain",
    "**MLSlotE** has no remaining uses in 2s. 2 uses left in 3s.",
    "**MLSlotH** has no remaining uses.",
    "",
    "_Example only — nobody is pinged._",
  ].join("\n");
}

function divisionComponents(
  creatorId: string,
  scope: "player" | "division" | "usage-division",
  divisions: TeamDivision[] = DIVISIONS,
): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `remind:division:${creatorId}:${scope}`,
      placeholder: "Choose a division",
      min_values: 1,
      max_values: 1,
      options: divisions.map(value => ({
        label: value,
        value,
        description: DIVISION_NAMES[value],
      })),
    }],
  }];
}

function playerComponents(
  creatorId: string,
  division: TeamDivision,
  players: Array<{sprocketPlayerId: string; name: string; slot: string | null}>,
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
        value: player.sprocketPlayerId,
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
        {label: "Normal", value: "normal", description: "Every 2 days at 1:30 PM ET, plus the target date"},
        {label: "Daily", value: "daily", description: "Every day at 1:30 PM ET through the target date"},
        {label: "Once", value: "once", description: "One reminder at 1:30 PM ET on the target date"},
      ],
    }],
  }];
}

function dateModal(
  creatorId: string,
  scope: ReminderScope,
  context: string,
): Response {
  return Response.json({
    type: 9,
    data: {
      custom_id: `remind:date:${creatorId}:${scope}:${encode(context)}`,
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

async function getConfiguredRoster(env: Env, guildId: string) {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return {config: null, players: []};
  const players = await getFranchisePlayers(env, config.franchise_name);
  return {config, players};
}

async function resolvePlayer(
  env: Env,
  guildId: string,
  division: TeamDivision,
  playerId: string,
) {
  const {config, players} = await getConfiguredRoster(env, guildId);
  if (!config) return {config: null, player: null};
  const player = players.find(value =>
    value.sprocketPlayerId === playerId &&
    isCompetitiveSlot(value.slot) &&
    teamDivision(value.skillGroup) === division
  ) ?? null;
  return {config, player};
}

function leagueRuleForDivision(
  rules: Array<{leagueCode: string; leagueName: string; requirement: number}>,
  division: TeamDivision,
) {
  return rules.find(rule =>
    rule.leagueCode.trim().toLocaleUpperCase("en-US") === division ||
    teamDivision(rule.leagueName) === division
  ) ?? null;
}

async function buildDivisionEligibilityReminder(
  env: Env,
  franchiseName: string,
  division: TeamDivision,
  targetDate: string,
): Promise<string> {
  const [players, events, rules] = await Promise.all([
    getFranchisePlayers(env, franchiseName),
    getEligibilityEvents(env),
    getLeagueEligibilityRules(env),
  ]);

  const rule = leagueRuleForDivision(rules, division);
  if (!rule) {
    return [
      `**${franchiseName} ${DIVISION_NAMES[division]} Eligibility Reminder**`,
      "",
      `Target date: **${formatShortDate(targetDate)}**`,
      "",
      `Eligibility requirement data is unavailable for ${division}.`,
    ].join("\n");
  }

  const award = inferScrimPointAward(events);
  if (!award) {
    return [
      `**${franchiseName} ${DIVISION_NAMES[division]} Eligibility Reminder**`,
      "",
      `Target date: **${formatShortDate(targetDate)}**`,
      "",
      "Hagrid could not infer the current scrim-point award from the eligibility ledger.",
    ].join("\n");
  }

  const roster = players
    .filter(player => isCompetitiveSlot(player.slot) && teamDivision(player.skillGroup) === division)
    .sort((a, b) =>
      slotLabel(a.slot).localeCompare(slotLabel(b.slot), "en-US", {numeric: true}) ||
      a.name.localeCompare(b.name),
    );

  const today = easternDate();
  const lines = [
    `**${franchiseName} ${DIVISION_NAMES[division]} Eligibility Reminder**`,
    "",
    `Target date: **${formatShortDate(targetDate)}**`,
    "",
  ];
  let anyNeeds = false;
  let anyDecayChange = false;

  for (const player of roster) {
    const playerEvents = events.filter(event => event.playerId === player.sprocketPlayerId);
    const steps = eligibilityNeedSteps(playerEvents, rule.requirement, award, targetDate, today);
    const need = formatEligibilityNeed(steps, targetDate);
    if (!need) continue;

    anyNeeds = true;
    anyDecayChange ||= need.hasDecayChange;
    const who = player.discordId ? `<@${player.discordId}>` : `**${player.name}**`;
    lines.push(`${who} ${need.text}${need.hasDecayChange ? "*" : ""}`);
  }

  if (!anyNeeds) {
    lines.push("✅ No current roster player is projected to need additional scrims for this target date.");
  }
  if (anyDecayChange) {
    lines.push(
      "",
      "*The difference is due to scrim point decay and being eligible on Monday of match week vs match time.",
    );
  }

  return lines.join("\n");
}

function captainMentions(
  players: Awaited<ReturnType<typeof getFranchisePlayers>>,
  division: TeamDivision,
): string[] {
  return players
    .filter(player => teamDivision(player.skillGroup) === division)
    .filter(player => {
      const role = `${player.staffPosition ?? ""} ${player.slot ?? ""}`.toLocaleUpperCase("en-US");
      return /(^|\b)(CAPT|CAPTAIN)(\b|$)/.test(role);
    })
    .map(player => player.discordId)
    .filter((value): value is string => Boolean(value))
    .map(discordId => `<@${discordId}>`);
}

async function buildDivisionUsageReminder(
  env: Env,
  franchiseName: string,
  division: TeamDivision,
): Promise<string> {
  const [players, usages] = await Promise.all([
    getFranchisePlayers(env, franchiseName),
    getFranchiseRoleUsagesForSeason(env, franchiseName, CURRENT_MLE_SEASON),
  ]);

  const alerts = buildUsageAlerts(division, players, usages);
  const captains = captainMentions(players, division);
  const lines = [
    `**${franchiseName} ${DIVISION_NAMES[division]} Usage Reminder**`,
    "",
    captains.length > 0 ? captains.join(" ") : "_No linked division captain found._",
    "",
  ];

  for (const alert of alerts) {
    const who = alert.player
      ? `**${alert.player.name}**`
      : `**Slot ${alert.slot}**`;
    lines.push(`${who} ${alert.text}`);
  }

  if (alerts.length === 0) {
    lines.push("✅ No roster slot is currently below the usage-warning thresholds.");
  }

  lines.push(
    "",
    "_Usage warnings trigger at fewer than 3 remaining uses in 2s, fewer than 3 in 3s, or fewer than 4 overall. Overall exhaustion is checked first, so illegal leftover mode uses are omitted._",
  );

  return lines.join("\n");
}

async function postUsageReminder(
  interaction: DiscordInteraction,
  env: Env,
  scope: "division" | "team",
  division: TeamDivision | null,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Usage reminders can only be posted inside a Discord server channel.");
  }
  const config = await getGuildConfig(env.DB, interaction.guild_id);
  if (!config) return discordMessage("No franchise is configured for this Discord server.");

  if (scope === "division") {
    if (!division) return discordMessage("That usage reminder is no longer valid.");
    const content = await buildDivisionUsageReminder(env, config.franchise_name, division);
    await sendDiscordChannelMessage(env, interaction.channel_id, content.slice(0, 1950));
    return discordMessage(`Posted the ${division} usage reminder.`);
  }

  for (const key of DIVISIONS) {
    const content = await buildDivisionUsageReminder(env, config.franchise_name, key);
    await sendDiscordChannelMessage(env, interaction.channel_id, content.slice(0, 1950));
  }
  return discordMessage("Posted the full-team usage reminders.");
}

async function postEligibilityReminder(
  interaction: DiscordInteraction,
  env: Env,
  scope: "division" | "team",
  division: TeamDivision | null,
  targetDate: string,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Eligibility reminders can only be posted inside a Discord server channel.");
  }
  const config = await getGuildConfig(env.DB, interaction.guild_id);
  if (!config) return discordMessage("No franchise is configured for this Discord server.");

  if (scope === "division") {
    if (!division) return discordMessage("That division reminder is no longer valid.");
    const content = await buildDivisionEligibilityReminder(env, config.franchise_name, division, targetDate);
    await sendDiscordChannelMessage(env, interaction.channel_id, content.slice(0, 1950));
    return discordMessage(`Posted the ${division} eligibility reminder for ${formatShortDate(targetDate)}.`);
  }

  for (const key of DIVISIONS) {
    const content = await buildDivisionEligibilityReminder(env, config.franchise_name, key, targetDate);
    await sendDiscordChannelMessage(env, interaction.channel_id, content.slice(0, 1950));
  }
  return discordMessage(`Posted the full-team eligibility reminder for ${formatShortDate(targetDate)}.`);
}

export async function handleRemindDummyCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id || !interaction.channel_id) {
    return discordMessage("Reminder demos can only be used inside a Discord server channel.");
  }
  const creatorId = invokerId(interaction);
  if (!creatorId) return discordMessage("Hagrid could not identify your Discord account.");
  if (!isAuthorizedReminderStaff(interaction)) {
    return discordMessage("Only the franchise Captain, AGM, GM, or FM can preview reminder flows.");
  }
  return discordMessage(
    "**Reminder dummy / demo**\nChoose the reminder flow to simulate. Nothing will be saved or pinged.",
    true,
    dummyComponents(creatorId),
  );
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
  if (!isAuthorizedReminderStaff(interaction)) {
    return discordMessage("Only the franchise Captain, AGM, GM, or FM can create reminders.");
  }

  return discordMessage(
    "**Create reminder**\nChoose whether this is for one player, one division, or the full team.",
    true,
    scopeComponents(creatorId),
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
  if (!isAuthorizedReminderStaff(interaction)) {
    return discordMessage("You no longer have permission to create reminders.");
  }

  if (parts[1] === "scope") {
    const scope = selectedValue(interaction) as ReminderScope | null;
    if (scope === "player" || scope === "division" || scope === "usage-division") {
      return discordUpdateMessage(
        scope === "player"
          ? "**Create player reminder**\nChoose the player's division."
          : scope === "division"
            ? "**Create division eligibility reminder**\nChoose the division."
            : "**Create division usage reminder**\nChoose the division.",
        divisionComponents(creatorId, scope, availableDivisionsForReminder(interaction)),
      );
    }
    if (scope === "team") {
      return dateModal(creatorId, "team", "ALL");
    }
    if (scope === "usage-team") {
      return postUsageReminder(interaction, env, "team", null);
    }
    return discordUpdateMessage("Choose a reminder type.", scopeComponents(creatorId));
  }

  if (parts[1] === "dummy") {
    const kind = selectedValue(interaction);
    if (!kind || !["player", "division", "team", "usage-division", "usage-team"].includes(kind)) {
      return discordUpdateMessage("Choose a valid reminder demo.", dummyComponents(creatorId));
    }
    return discordUpdateMessage(dummyReminderText(kind), []);
  }

  if (parts[1] === "division") {
    const scope = parts[3] as "player" | "division" | "usage-division";
    const division = selectedValue(interaction)?.toLocaleUpperCase("en-US") as TeamDivision | undefined;
    const allowedDivisions = availableDivisionsForReminder(interaction);
    if (
      !division ||
      !DIVISIONS.includes(division) ||
      !allowedDivisions.includes(division) ||
      (scope !== "player" && scope !== "division" && scope !== "usage-division")
    ) {
      return discordMessage("That division selection is no longer valid.");
    }

    if (scope === "division") {
      return dateModal(creatorId, "division", division);
    }
    if (scope === "usage-division") {
      return postUsageReminder(interaction, env, "division", division);
    }

    const {config, players} = await getConfiguredRoster(env, interaction.guild_id);
    if (!config) return discordUpdateMessage("No franchise is configured for this Discord server.");

    const roster = players
      .filter(player => isCompetitiveSlot(player.slot) && teamDivision(player.skillGroup) === division)
      .sort((a, b) =>
        slotLabel(a.slot).localeCompare(slotLabel(b.slot), "en-US", {numeric: true}) ||
        a.name.localeCompare(b.name),
      );

    if (roster.length === 0) {
      return discordUpdateMessage(`No current competitive ${division} players were found for ${config.franchise_name}.`);
    }

    return discordUpdateMessage(
      `**Create player reminder — ${division}**\nChoose the player.`,
      playerComponents(creatorId, division, roster),
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
    if (!resolved.player.discordId) {
      return discordMessage(`${resolved.player.name} does not have a linked Discord ID, so Hagrid cannot ping them.`);
    }

    return dateModal(creatorId, "player", `${division}|${playerId}`);
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
    if (!resolved.config || !resolved.player?.discordId) {
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
      resolved.player.sprocketPlayerId,
      resolved.player.discordId,
      resolved.player.name,
      division,
      dueDate,
      cadence,
      creatorId,
    ).run();

    if (!result.success) return discordMessage("Hagrid could not save that reminder.");

    const cadenceText = cadence === "normal"
      ? "Normal — every 2 days at 1:30 PM ET, anchored to the target date"
      : cadence === "daily"
        ? "Daily — every day at 1:30 PM ET through the target date"
        : "Once — 1:30 PM ET on the target date";

    return discordUpdateMessage(
      `✅ Reminder created for <@${resolved.player.discordId}>.\n**${division} · ${resolved.player.name}**\nBefore **${formatShortDate(dueDate)}** · **${cadenceText}**`,
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
  const scope = parts[3] as ReminderScope;
  const context = decode(parts[4] ?? "");
  const actorId = invokerId(interaction);
  if (!actorId || actorId !== creatorId) {
    return discordMessage("Only the staff member who started this reminder can continue it.");
  }
  if (!isAuthorizedReminderStaff(interaction)) {
    return discordMessage("You no longer have permission to create reminders.");
  }

  const rawDate = modalInput(interaction, "before");
  const dueDate = rawDate ? parseReminderDate(rawDate) : null;
  if (!dueDate) {
    return discordMessage("That date is not valid. Run `/remind` again and enter it as `mm/dd/yy`.");
  }
  if (dueDate < easternDate()) {
    return discordMessage("The reminder date cannot be in the past. Run `/remind` again.");
  }

  if (scope === "division") {
    const division = context as TeamDivision;
    if (!DIVISIONS.includes(division) || !availableDivisionsForReminder(interaction).includes(division)) {
      return discordMessage("That division reminder is no longer valid for your role.");
    }
    return postEligibilityReminder(interaction, env, "division", division, dueDate);
  }

  if (scope === "team") {
    return postEligibilityReminder(interaction, env, "team", null, dueDate);
  }

  if (scope !== "player") return discordMessage("That reminder form is no longer valid.");

  const [divisionRaw, playerId] = context.split("|");
  const division = divisionRaw as TeamDivision;
  if (!DIVISIONS.includes(division) || !playerId) {
    return discordMessage("That player reminder is no longer valid.");
  }

  const resolved = await resolvePlayer(env, interaction.guild_id, division, playerId);
  if (!resolved.player) return discordMessage("That player is no longer on the selected divisional roster.");

  return discordMessage(
    `**Create player reminder — ${division} · ${resolved.player.name}**\nBefore **${formatShortDate(dueDate)}**. How often should Hagrid remind them?`,
    true,
    cadenceComponents(creatorId, division, playerId, dueDate),
  );
}
