export const EASTERN_TIME_ZONE = "America/New_York";

function easternDateParts(now = new Date()): {year: number; month: number; day: number; weekday: string} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const values = new Map(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    weekday: values.get("weekday") ?? "Mon",
  };
}

export function currentEasternWeekStart(now = new Date()): string {
  const parts = easternDateParts(now);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (weekdayIndex + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}
