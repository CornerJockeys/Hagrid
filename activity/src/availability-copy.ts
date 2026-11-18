export interface CopyAvailabilitySlot {
  day: number;
  minute: number;
  state: 1 | 2;
}

export interface CopyAvailabilityPlayer {
  name: string;
  submitted: boolean;
  slots: CopyAvailabilitySlot[];
}

const fullDayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function key(day: number, minute: number): string {
  return `${day}:${minute}`;
}

function compactTime(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 || 12;
  return mins === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(mins).padStart(2, "0")}${suffix}`;
}

function compactTimeWithoutSuffix(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const hour12 = hour24 % 12 || 12;
  return mins === 0
    ? String(hour12)
    : `${hour12}:${String(mins).padStart(2, "0")}`;
}

function timeSuffix(minute: number): "am" | "pm" {
  const hour24 = Math.floor(minute / 60) % 24;
  return hour24 >= 12 ? "pm" : "am";
}

function compactRange(startMinute: number, lastStartMinute: number): string {
  if (startMinute === lastStartMinute) return compactTime(startMinute);
  const start = timeSuffix(startMinute) === timeSuffix(lastStartMinute)
    ? compactTimeWithoutSuffix(startMinute)
    : compactTime(startMinute);
  return `${start}-${compactTime(lastStartMinute)}`;
}

function qualifyingBlocks(
  players: readonly CopyAvailabilityPlayer[],
  threshold: number,
  startMinute: number,
  endMinute: number,
  resolution: 30 | 60,
): Array<{day: number; minute: number; names: string[]}> {
  const prepared = players
    .filter(player => player.submitted)
    .map(player => ({
      ...player,
      values: new Set(
        player.slots
          .filter(slot => slot.state === 1 || slot.state === 2)
          .map(slot => key(slot.day, slot.minute)),
      ),
    }));

  const blocks: Array<{day: number; minute: number; names: string[]}> = [];
  for (let day = 0; day < 7; day += 1) {
    for (let minute = startMinute; minute < endMinute; minute += resolution) {
      const names = prepared
        .filter(player => {
          for (let offset = 0; offset < resolution; offset += 30) {
            if (!player.values.has(key(day, minute + offset))) return false;
          }
          return true;
        })
        .map(player => player.name);

      if (names.length < threshold) continue;
      blocks.push({day, minute, names});
    }
  }
  return blocks;
}

export function availabilityCopyLines(
  players: readonly CopyAvailabilityPlayer[],
  threshold: number,
  startMinute: number,
  endMinute: number,
  resolution: 30 | 60,
): string[] {
  return qualifyingBlocks(
    players,
    threshold,
    startMinute,
    endMinute,
    resolution,
  ).map(block =>
    `${fullDayNames[block.day]} ${compactTime(block.minute)}, ${block.names.join(", ")}.`,
  );
}

export function availabilityCopyRangeLines(
  players: readonly CopyAvailabilityPlayer[],
  threshold: number,
  startMinute: number,
  endMinute: number,
  resolution: 30 | 60,
): string[] {
  const blocks = qualifyingBlocks(
    players,
    threshold,
    startMinute,
    endMinute,
    resolution,
  );
  const lines: string[] = [];

  for (let day = 0; day < 7; day += 1) {
    const minutes = blocks
      .filter(block => block.day === day)
      .map(block => block.minute);
    if (minutes.length === 0) continue;

    let rangeStart = minutes[0];
    let previous = minutes[0];

    for (const minute of minutes.slice(1)) {
      if (minute === previous + resolution) {
        previous = minute;
        continue;
      }
      lines.push(`${fullDayNames[day]} ${compactRange(rangeStart, previous)}`);
      rangeStart = minute;
      previous = minute;
    }
    lines.push(`${fullDayNames[day]} ${compactRange(rangeStart, previous)}`);
  }

  return lines;
}

export function availabilityCopyText(
  players: readonly CopyAvailabilityPlayer[],
  division: "FL" | "AL" | "CL" | "ML",
  threshold: 2 | 3,
  startMinute: number,
  endMinute: number,
  resolution: 30 | 60,
): {text: string; lines: string[]} {
  const lines = availabilityCopyLines(
    players,
    threshold,
    startMinute,
    endMinute,
    resolution,
  );
  return {
    lines,
    text: `Copy of ${division} ${threshold}+ players\n\n${lines.join("\n")}`,
  };
}

export function availabilityTimesCopyText(
  players: readonly CopyAvailabilityPlayer[],
  division: "FL" | "AL" | "CL" | "ML",
  threshold: 2 | 3,
  startMinute: number,
  endMinute: number,
  resolution: 30 | 60,
): {text: string; lines: string[]} {
  const lines = availabilityCopyRangeLines(
    players,
    threshold,
    startMinute,
    endMinute,
    resolution,
  );
  return {
    lines,
    text: `Copy of ${division} ${threshold}+ times\n\n${lines.join("\n")}`,
  };
}
