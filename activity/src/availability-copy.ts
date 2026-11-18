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

export function availabilityCopyLines(
  players: readonly CopyAvailabilityPlayer[],
  threshold: number,
  startMinute: number,
  endMinute: number,
  resolution: 30 | 60,
): string[] {
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

  const lines: string[] = [];
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
      lines.push(`${fullDayNames[day]} ${compactTime(minute)}, ${names.join(", ")}.`);
    }
  }
  return lines;
}


export function availabilityCopyText(
  players: readonly CopyAvailabilityPlayer[],
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
    text: `Copy of ${threshold}+ times\n\n${lines.join("\n")}`,
  };
}
