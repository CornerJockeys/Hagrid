export interface EligibilityEvent {
  playerId: string;
  createdDate: string;
  points: number;
}

export interface EligibilityDecayPoint {
  date: string;
  points: number;
  weekStart: string;
  eligible: boolean;
  isMonday: boolean;
  isToday: boolean;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string | null {
  const date = parseIsoDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function mondayOf(value: string): string | null {
  const date = parseIsoDate(value);
  if (!date) return null;
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return isoDate(date);
}

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map(part => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function pointsOnDate(events: EligibilityEvent[], date: string): number {
  let total = 0;
  for (const event of events) {
    // Evidence's eligibility view keeps a scrim active through the date exactly
    // 30 days after it was played, then removes it the following day.
    const expiresExclusive = addDays(event.createdDate, 31);
    if (!expiresExclusive) continue;
    if (event.createdDate <= date && expiresExclusive > date) total += event.points;
  }
  return total;
}

export function buildEligibilityDecay(
  events: EligibilityEvent[],
  requirement: number,
  today = easternCalendarDate(),
): EligibilityDecayPoint[] {
  if (!Number.isFinite(requirement) || requirement < 0) {
    throw new Error("Eligibility requirement must be a non-negative number.");
  }

  const weekStart = mondayOf(today);
  const endDate = addDays(today, 30);
  if (!weekStart || !endDate) throw new Error("A valid YYYY-MM-DD date is required.");

  const weekUnlocked = new Map<string, boolean>();
  const output: EligibilityDecayPoint[] = [];
  let cursor = weekStart;

  while (cursor <= endDate) {
    const currentWeek = mondayOf(cursor);
    if (!currentWeek) break;
    const points = pointsOnDate(events, cursor);
    const unlocked = (weekUnlocked.get(currentWeek) ?? false) || points >= requirement;
    weekUnlocked.set(currentWeek, unlocked);

    output.push({
      date: cursor,
      points,
      weekStart: currentWeek,
      eligible: unlocked,
      isMonday: cursor === currentWeek,
      isToday: cursor === today,
    });

    const next = addDays(cursor, 1);
    if (!next) break;
    cursor = next;
  }

  return output;
}
