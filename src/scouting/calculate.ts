export type LeagueCode = "FL" | "AL" | "CL" | "ML" | "PL";
export type ProspectStatus = "FA" | "PEND";
export type ScoutingMode = "2s" | "3s";
export type ScoutingBucket = "Hot" | "Warm" | "Cold";
export type RoleLabel = "1st" | "2nd" | "3rd";

export interface ProspectIdentity {
  sprocketPlayerId: string;
  name: string;
  salary: number | null;
  league: LeagueCode;
  status: ProspectStatus;
}

export interface RawScoutingLine {
  sprocketPlayerId: string;
  mode: ScoutingMode;
  league: LeagueCode | null;
  games: number;
  winPct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  demos: number | null;
}

export interface ScoutingRecord extends ProspectIdentity {
  mode: ScoutingMode;
  games: number;
  winPct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  shotPct: number | null;
  demos: number | null;
  effSalary: number | null;
  temp: number;
  tempScore: number;
  bucket: ScoutingBucket;
  mainRole: RoleLabel;
  altRole: RoleLabel;
  roleConfidence: "High" | "Med" | "Low";
  flags: string;
}

interface Candidate extends ProspectIdentity {
  mode: ScoutingMode;
  games: number;
  winPct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  demos: number | null;
  shotPct: number | null;
  rawEffSalary: number | null;
}

type MetricKey =
  | "winPct"
  | "goals"
  | "assists"
  | "saves"
  | "shots"
  | "demos"
  | "dpi"
  | "opi"
  | "score"
  | "sprocket";

const TEMP_WEIGHTS: ReadonlyArray<[MetricKey, number]> = [
  ["winPct", 2.0],
  ["goals", 1.6],
  ["assists", 1.3],
  ["saves", 1.3],
  ["shots", 1.0],
  ["demos", 0.8],
  ["dpi", 1.4],
  ["opi", 1.4],
  ["score", 1.2],
  ["sprocket", 1.6],
];

const TEMP_CAP_PCT = 0.15;
const BREADTH_HIGH = 1.12;
const BREADTH_LOW = 0.88;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function computeEfficiency(candidate: Pick<Candidate, "dpi" | "opi" | "sprocket" | "score" | "winPct">): number | null {
  if (finite(candidate.dpi) && finite(candidate.opi)) {
    return (candidate.dpi + candidate.opi) / 2;
  }
  if (finite(candidate.sprocket)) return candidate.sprocket;
  if (finite(candidate.score)) return candidate.score;
  if (finite(candidate.winPct)) return candidate.winPct * 100;
  return null;
}

function weightedAverage(candidates: Candidate[], key: MetricKey): number | null {
  let weighted = 0;
  let weight = 0;
  for (const candidate of candidates) {
    const value = candidate[key];
    if (!finite(value)) continue;
    const games = candidate.games > 0 ? candidate.games : 1;
    weighted += value * games;
    weight += games;
  }
  return weight > 0 ? weighted / weight : null;
}

function ratio(value: number | null, average: number | null): number {
  if (!finite(value) || !finite(average) || average === 0) return 1;
  return value / average;
}

function roleScores(
  candidate: Candidate,
  averages: Record<MetricKey, number | null>,
): Array<{role: RoleLabel; score: number}> {
  const goals = ratio(candidate.goals, averages.goals);
  const assists = ratio(candidate.assists, averages.assists);
  const saves = ratio(candidate.saves, averages.saves);
  const shots = ratio(candidate.shots, averages.shots);
  const scores: Array<{role: RoleLabel; score: number}> = [
    {role: "1st", score: 1.8 * goals + 1.2 * assists + shots},
    {role: "2nd", score: 1.8 * assists + 1.2 * goals + shots},
    {role: "3rd", score: 1.8 * saves + 1.2 * goals + shots},
  ];
  return scores.sort((left, right) => right.score - left.score || left.role.localeCompare(right.role));
}

function flags(candidate: Candidate): string {
  const values: string[] = [];
  if (candidate.games < 9) values.push("Low games sample");
  const totalShots = (candidate.shots ?? 0) * candidate.games;
  const shotFloor = candidate.mode === "2s" ? 20 : 15;
  if (totalShots < shotFloor) values.push("Low shots sample");
  return values.join(" • ");
}

function buildCandidate(identity: ProspectIdentity, line: RawScoutingLine): Candidate {
  const shotPct = finite(line.goals) && finite(line.shots) && line.shots > 0
    ? line.goals / line.shots
    : null;
  const efficiency = computeEfficiency(line);
  const rawEffSalary = finite(efficiency) && finite(identity.salary) && identity.salary > 0
    ? efficiency / identity.salary
    : null;

  return {
    sprocketPlayerId: identity.sprocketPlayerId,
    name: identity.name,
    salary: identity.salary,
    league: identity.league,
    status: identity.status,
    mode: line.mode,
    games: line.games,
    winPct: line.winPct,
    score: line.score,
    sprocket: line.sprocket,
    dpi: line.dpi,
    opi: line.opi,
    goals: line.goals,
    assists: line.assists,
    saves: line.saves,
    shots: line.shots,
    demos: line.demos,
    shotPct,
    rawEffSalary,
  };
}

function selectLine(
  identity: ProspectIdentity,
  lines: RawScoutingLine[],
  mode: ScoutingMode,
): RawScoutingLine | null {
  const matching = lines
    .filter(line =>
      line.sprocketPlayerId === identity.sprocketPlayerId &&
      line.mode === mode &&
      (line.league === null || line.league === identity.league),
    )
    .sort((left, right) => right.games - left.games);
  return matching[0] ?? null;
}

export function buildScoutingRecords(
  identities: ProspectIdentity[],
  lines: RawScoutingLine[],
): ScoutingRecord[] {
  const candidates: Candidate[] = [];
  for (const identity of identities) {
    for (const mode of ["2s", "3s"] as const) {
      const line = selectLine(identity, lines, mode);
      if (!line || line.games <= 0) continue;
      candidates.push(buildCandidate(identity, line));
    }
  }

  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.league}|${candidate.mode}`;
    const group = grouped.get(key) ?? [];
    group.push(candidate);
    grouped.set(key, group);
  }

  const records: ScoutingRecord[] = [];
  for (const group of grouped.values()) {
    const averages = Object.fromEntries(
      TEMP_WEIGHTS.map(([key]) => [key, weightedAverage(group, key)]),
    ) as Record<MetricKey, number | null>;

    const effValues = group
      .map(candidate => candidate.rawEffSalary)
      .filter(finite);
    const effAverage = effValues.length > 0
      ? effValues.reduce((sum, value) => sum + value, 0) / effValues.length
      : null;

    const interim = group.map(candidate => {
      let weightedScore = 0;
      let totalWeight = 0;
      let breadthGood = 0;
      let breadthBad = 0;

      for (const [key, weight] of TEMP_WEIGHTS) {
        const rawRatio = ratio(candidate[key], averages[key]);
        const clampedRatio = clamp(rawRatio, 0.5, 2.0);
        weightedScore += weight * (clampedRatio - 1);
        totalWeight += weight;
        if (rawRatio >= BREADTH_HIGH) breadthGood += 1;
        if (rawRatio <= BREADTH_LOW) breadthBad += 1;
      }

      const tempScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
      const temp = clamp((tempScore + 0.5) / 1.5, 0, 1);
      const roles = roleScores(candidate, averages);
      const roleGap = roles[0].score - roles[1].score;
      const roleConfidence = roleGap >= 0.8 ? "High" : roleGap >= 0.35 ? "Med" : "Low";
      const effSalary = finite(candidate.rawEffSalary) && finite(effAverage) && effAverage !== 0
        ? clamp((candidate.rawEffSalary / effAverage) * 50, 0, 100)
        : null;

      return {
        candidate,
        tempScore,
        temp,
        breadthGood,
        breadthBad,
        roles,
        roleConfidence: roleConfidence as "High" | "Med" | "Low",
        effSalary,
      };
    });

    const byTemperature = [...interim].sort((left, right) =>
      right.tempScore - left.tempScore || left.candidate.name.localeCompare(right.candidate.name),
    );
    const cap = Math.max(1, Math.floor(byTemperature.length * TEMP_CAP_PCT));
    const hot = new Set(
      byTemperature
        .slice(0, cap)
        .filter(value => value.breadthGood >= 3 && value.breadthBad <= 2)
        .map(value => value.candidate.sprocketPlayerId),
    );
    const cold = new Set(
      byTemperature
        .slice(Math.max(0, byTemperature.length - cap))
        .filter(value => value.breadthBad >= 3 && value.breadthGood <= 2)
        .map(value => value.candidate.sprocketPlayerId),
    );

    for (const value of interim) {
      const candidate = value.candidate;
      let bucket: ScoutingBucket = "Warm";
      if (hot.has(candidate.sprocketPlayerId)) bucket = "Hot";
      else if (cold.has(candidate.sprocketPlayerId)) bucket = "Cold";

      records.push({
        sprocketPlayerId: candidate.sprocketPlayerId,
        name: candidate.name,
        salary: candidate.salary,
        league: candidate.league,
        status: candidate.status,
        mode: candidate.mode,
        games: candidate.games,
        winPct: candidate.winPct,
        score: candidate.score,
        sprocket: candidate.sprocket,
        dpi: candidate.dpi,
        opi: candidate.opi,
        goals: candidate.goals,
        assists: candidate.assists,
        saves: candidate.saves,
        shots: candidate.shots,
        shotPct: candidate.shotPct,
        demos: candidate.demos,
        effSalary: value.effSalary,
        temp: value.temp,
        tempScore: value.tempScore,
        bucket,
        mainRole: value.roles[0].role,
        altRole: value.roles[1].role,
        roleConfidence: value.roleConfidence,
        flags: flags(candidate),
      });
    }
  }

  return records.sort((left, right) =>
    left.league.localeCompare(right.league) ||
    left.mode.localeCompare(right.mode) ||
    left.name.localeCompare(right.name),
  );
}
