import type {AvailabilitySlot} from "../activity/availability";

export type DivisionCode = "FL" | "AL" | "CL" | "ML" | "PL";

export interface AvailabilityRosterPlayer {
  sprocketPlayerId: string;
  discordUserId: string | null;
  name: string;
  division: DivisionCode | null;
  salary: number | null;
  slot: string | null;
  staffPosition: string | null;
}

export interface AvailabilitySubmission {
  discordUserId: string;
  slots: AvailabilitySlot[];
  updatedAt: string;
}

export interface TeamAvailabilityPlayer extends AvailabilityRosterPlayer {
  submitted: boolean;
  linked: boolean;
  updatedAt: string | null;
  slots: AvailabilitySlot[];
}

export interface TeamAvailabilityCell {
  day: number;
  minute: number;
  available: number;
  preferred: number;
  submitted: number;
  roster: number;
}

export interface TeamAvailabilitySummary {
  players: TeamAvailabilityPlayer[];
  cells: TeamAvailabilityCell[];
  missing: TeamAvailabilityPlayer[];
  divisions: DivisionCode[];
}

export function divisionCode(value: string | null): DivisionCode | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "fl" || normalized.includes("foundation")) return "FL";
  if (normalized === "al" || normalized.includes("academy")) return "AL";
  if (normalized === "cl" || normalized.includes("champion")) return "CL";
  if (normalized === "ml" || normalized.includes("master")) return "ML";
  if (normalized === "pl" || normalized.includes("premier")) return "PL";
  return null;
}

export function isCompetitiveAvailabilityPlayer(player: AvailabilityRosterPlayer): boolean {
  // Salary is the most stable public-data indicator that this is an active competitive
  // roster entry rather than franchise-only staff. Captains remain included because
  // they carry a player salary like the rest of the roster.
  return player.salary !== null && player.division !== null;
}

function slotKey(day: number, minute: number): string {
  return `${day}:${minute}`;
}

export function aggregateTeamAvailability(
  roster: AvailabilityRosterPlayer[],
  submissions: AvailabilitySubmission[],
  startMinute: number,
  endMinute: number,
  resolutionMinutes: number,
  division: DivisionCode | null = null,
): TeamAvailabilitySummary {
  const availableRoster = roster
    .filter(isCompetitiveAvailabilityPlayer)
    .filter(player => !division || player.division === division)
    .sort((left, right) =>
      (left.division ?? "").localeCompare(right.division ?? "") ||
      left.name.localeCompare(right.name),
    );

  const submissionsByDiscord = new Map(submissions.map(value => [value.discordUserId, value]));
  const players: TeamAvailabilityPlayer[] = availableRoster.map(player => {
    const submission = player.discordUserId
      ? submissionsByDiscord.get(player.discordUserId) ?? null
      : null;
    return {
      ...player,
      linked: Boolean(player.discordUserId),
      submitted: submission !== null,
      updatedAt: submission?.updatedAt ?? null,
      slots: submission?.slots ?? [],
    };
  });

  const cells: TeamAvailabilityCell[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (let minute = startMinute; minute < endMinute; minute += resolutionMinutes) {
      let available = 0;
      let preferred = 0;
      let submitted = 0;

      for (const player of players) {
        if (player.submitted) submitted += 1;
        const state = player.slots.find(slot => slot.day === day && slot.minute === minute)?.state;
        if (state === 1 || state === 2) available += 1;
        if (state === 2) preferred += 1;
      }

      cells.push({
        day,
        minute,
        available,
        preferred,
        submitted,
        roster: players.length,
      });
    }
  }

  const missing = players.filter(player => !player.submitted || !player.linked);
  const divisions = [...new Set(
    roster
      .filter(isCompetitiveAvailabilityPlayer)
      .map(player => player.division)
      .filter((value): value is DivisionCode => value !== null),
  )].sort((left, right) => left.localeCompare(right));

  // Keep the function deterministic even if a caller provided duplicate slots.
  for (const player of players) {
    const unique = new Map(player.slots.map(slot => [slotKey(slot.day, slot.minute), slot]));
    player.slots = [...unique.values()].sort((a, b) => a.day - b.day || a.minute - b.minute);
  }

  return {players, cells, missing, divisions};
}
