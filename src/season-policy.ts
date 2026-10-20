export const CURRENT_MLE_SEASON = 20;

export type MleDivision = "FL" | "AL" | "CL" | "ML" | "PL";

export interface DivisionPolicy {
  rosterSlots: number;
  teamSalaryPlayers: number;
  salaryCap: number;
  doublesLimit: number;
  standardLimit: number;
  combinedLimit: number;
}

// Season 20 League Operations Rulebook policy.
//
// AL/CL/ML: eight active-roster slots, top five salaries, 6/8/12 usage.
// FL/PL: four active-roster slots, top four salaries, 6/9/15 usage.
export const S20_DIVISION_POLICY: Record<MleDivision, DivisionPolicy> = {
  FL: {rosterSlots: 4, teamSalaryPlayers: 4, salaryCap: 34.5, doublesLimit: 6, standardLimit: 9, combinedLimit: 15},
  AL: {rosterSlots: 8, teamSalaryPlayers: 5, salaryCap: 62.5, doublesLimit: 6, standardLimit: 8, combinedLimit: 12},
  CL: {rosterSlots: 8, teamSalaryPlayers: 5, salaryCap: 74.5, doublesLimit: 6, standardLimit: 8, combinedLimit: 12},
  ML: {rosterSlots: 8, teamSalaryPlayers: 5, salaryCap: 86.5, doublesLimit: 6, standardLimit: 8, combinedLimit: 12},
  PL: {rosterSlots: 4, teamSalaryPlayers: 4, salaryCap: 79.0, doublesLimit: 6, standardLimit: 9, combinedLimit: 15},
};

export function divisionPolicy(division: MleDivision): DivisionPolicy {
  return S20_DIVISION_POLICY[division];
}

export function teamSalaryFromKnownPlayers(
  division: MleDivision,
  salaries: Array<number | null | undefined>,
): number {
  const policy = divisionPolicy(division);
  return salaries
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => right - left)
    .slice(0, policy.teamSalaryPlayers)
    .reduce((sum, value) => sum + value, 0);
}

export function capSpaceFromKnownPlayers(
  division: MleDivision,
  salaries: Array<number | null | undefined>,
): number {
  return divisionPolicy(division).salaryCap - teamSalaryFromKnownPlayers(division, salaries);
}

// Season 20 operational dates. These are New Week Deadline dates (Monday ET)
// derived from the maintained S20 schedule and the rulebook lock rules.
export const S20_FIRST_MATCH_WEEK_NEW_WEEK_DATE = "2026-10-26";
export const S20_USAGE_REPORT_START_DATE = "2026-11-02";
export const S20_ELIGIBILITY_SALARY_LOCK_DATE = "2027-01-04";
export const S20_ROSTER_LOCK_DATE = "2027-01-11";
export const S20_FINAL_REGULAR_SEASON_CHECK_DATE = "2027-01-25";

export type S20WeeklyReportKind = "eligibility" | "salary" | "usage";

export function s20WeeklyReportKinds(date: string): S20WeeklyReportKind[] {
  if (date < S20_FIRST_MATCH_WEEK_NEW_WEEK_DATE || date > S20_FINAL_REGULAR_SEASON_CHECK_DATE) {
    return [];
  }

  const kinds: S20WeeklyReportKind[] = [];
  if (date <= S20_ELIGIBILITY_SALARY_LOCK_DATE) {
    kinds.push("eligibility", "salary");
  }
  if (date >= S20_USAGE_REPORT_START_DATE) {
    kinds.push("usage");
  }
  return kinds;
}

// Avg_Scrim_Stats is the official Season 20 scrim aggregate. Season 20 began
// on this date, so consumers can use that dataset directly for S20 scrim stats.
export const SCRIM_STATS_START_DATE = "2026-09-06";
