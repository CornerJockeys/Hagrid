import type {EligibilityEvent} from "../eligibility-decay";

export interface EligibilityNeedStep {
  date: string;
  scrims: number;
}

function parseIso(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

export function mondayOfDate(value: string): string {
  const date = parseIso(value);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return iso(date);
}

export function formatShortDate(value: string): string {
  const date = parseIso(value);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCFullYear()).slice(-2)}`;
}

export function inferScrimPointAward(events: EligibilityEvent[]): number | null {
  const counts = new Map<number, number>();
  for (const event of events) {
    if (!Number.isFinite(event.points) || event.points <= 0) continue;
    counts.set(event.points, (counts.get(event.points) ?? 0) + 1);
  }
  let best: {points: number; count: number} | null = null;
  for (const [points, count] of counts) {
    if (!best || count > best.count || (count === best.count && points < best.points)) {
      best = {points, count};
    }
  }
  return best?.points ?? null;
}

export function activePointsOnDate(events: EligibilityEvent[], date: string): number {
  let total = 0;
  for (const event of events) {
    const expiresExclusive = addDays(event.createdDate, 31);
    if (event.createdDate <= date && expiresExclusive > date) total += event.points;
  }
  return total;
}

export function eligibilityNeedSteps(
  events: EligibilityEvent[],
  requirement: number,
  scrimAward: number,
  targetDate: string,
  today: string,
): EligibilityNeedStep[] {
  if (scrimAward <= 0 || requirement < 0 || targetDate < today) return [];

  const targetWeekMonday = mondayOfDate(targetDate);
  const startDate = today > targetWeekMonday ? today : targetWeekMonday;

  // If the target week has already started and the player reached the threshold
  // at any point this week, eligibility is latched through the rest of the week.
  if (targetWeekMonday <= today) {
    let checkDate = targetWeekMonday;
    const checkThrough = today < targetDate ? today : targetDate;
    while (checkDate <= checkThrough) {
      if (activePointsOnDate(events, checkDate) >= requirement) {
        return [{date: startDate, scrims: 0}];
      }
      checkDate = addDays(checkDate, 1);
    }
  }

  const steps: EligibilityNeedStep[] = [];
  let cursor = startDate;
  let lastNeed: number | null = null;

  while (cursor <= targetDate) {
    const points = activePointsOnDate(events, cursor);
    const need = Math.max(0, Math.ceil((requirement - points) / scrimAward));
    if (lastNeed === null || need !== lastNeed) {
      steps.push({date: cursor, scrims: need});
      lastNeed = need;
    }
    cursor = addDays(cursor, 1);
  }

  return steps;
}

export function formatEligibilityNeed(
  steps: EligibilityNeedStep[],
  targetDate: string,
): {text: string; hasDecayChange: boolean} | null {
  if (steps.length === 0 || steps[0].scrims === 0) return null;

  const first = steps[0];
  let text = `needs ${first.scrims} scrim${first.scrims === 1 ? "" : "s"} by ${formatShortDate(first.date)} to be eligible by ${formatShortDate(targetDate)}`;
  const later = steps.slice(1).filter(step => step.scrims > first.scrims);
  for (const step of later) {
    text += `. ${step.scrims} scrim${step.scrims === 1 ? "" : "s"} if not done by ${formatShortDate(step.date)}`;
  }
  return {text: text + ".", hasDecayChange: later.length > 0};
}
