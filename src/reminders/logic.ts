const EASTERN_TIME_ZONE = "America/New_York";

function easternParts(now: Date): {year: number; month: number; day: number} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return {
    year: Number(parts.find(part => part.type === "year")?.value),
    month: Number(parts.find(part => part.type === "month")?.value),
    day: Number(parts.find(part => part.type === "day")?.value),
  };
}

export function easternDate(now = new Date()): string {
  const {year, month, day} = easternParts(now);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function easternHour(now = new Date()): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number(value);
}

export function parseReminderDate(value: string): string | null {
  const trimmed = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
    if (year < 100) year += 2000;
  } else {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;

  return check.toISOString().slice(0, 10);
}

function dateNumber(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

export function daysUntil(deadline: string, date: string): number {
  return Math.round((dateNumber(deadline) - dateNumber(date)) / 86_400_000);
}

/**
 * Normal cadence is anchored backward from the deadline: deadline day,
 * two days before, four days before, and so on. This guarantees a final ping.
 */
export function normalReminderDue(deadline: string, date: string): boolean {
  const remaining = daysUntil(deadline, date);
  return remaining >= 0 && remaining % 2 === 0;
}


export function reminderDue(cadence: string, deadline: string, date: string): boolean {
  if (date > deadline) return false;
  if (cadence === "daily") return true;
  if (cadence === "once") return date === deadline;
  return normalReminderDue(deadline, date);
}
