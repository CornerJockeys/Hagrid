const EASTERN_TIME_ZONE = "America/New_York";

function canonicalDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function easternDateParts(now: Date): {year: number; month: number; day: number} {
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

export function eligibilityCalendarDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    return canonicalDateParts(Number(isoDateOnly[1]), Number(isoDateOnly[2]), Number(isoDateOnly[3]));
  }

  const usDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  if (usDate) {
    return canonicalDateParts(Number(usDate[3]), Number(usDate[1]), Number(usDate[2]));
  }

  // Timestamp strings with an explicit offset/Z are converted to their Eastern
  // calendar date because MLE weekly eligibility is evaluated on Eastern time.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    const {year, month, day} = easternDateParts(parsed);
    return canonicalDateParts(year, month, day);
  }

  // For timezone-less timestamps, treat the written date as the league-local
  // calendar date instead of letting the runtime reinterpret it in UTC.
  const localIso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
  if (localIso) {
    return canonicalDateParts(Number(localIso[1]), Number(localIso[2]), Number(localIso[3]));
  }

  return null;
}

export function currentLeagueWeekStart(now = new Date()): string {
  const {year, month, day} = easternDateParts(now);
  const easternDate = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (easternDate.getUTCDay() + 6) % 7;
  easternDate.setUTCDate(easternDate.getUTCDate() - daysSinceMonday);
  return easternDate.toISOString().slice(0, 10);
}

/**
 * MLE weekly eligibility rule: if a player is eligible at any point on the
 * Monday that begins a league week (including exactly 12:00 AM), they are
 * treated as eligible for that entire week.
 */
export function isEligibleForWeek(eligibleThrough: string | null, weekStart: string): boolean {
  const eligibilityDate = eligibilityCalendarDate(eligibleThrough);
  const monday = eligibilityCalendarDate(weekStart);
  if (!eligibilityDate || !monday) return false;
  return eligibilityDate >= monday;
}
