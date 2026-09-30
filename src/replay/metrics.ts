export interface ReplayPlayerStats {
  name: string;
  team: 0 | 1;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  bot: boolean;
  onlineId: string | null;
  platform: string | null;
}

export interface RatedReplayPlayer extends ReplayPlayerStats {
  goalsAgainst: number;
  shotsAgainst: number;
  mvpr: number;
  opi: number | null;
  dpi: number | null;
  gpi: number | null;
}

interface SprocketConstants {
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  xOpi: number;
  yOpi: number;
  xDpi: number;
  yDpi: number;
  opponentDivisor: number;
}

const BETA = -Math.log(9);

const DOUBLES: SprocketConstants = {
  goals: 1.54,
  assists: 0.79,
  saves: 1.75,
  shots: 3.93,
  xOpi: 2.01,
  yOpi: 1.34,
  xDpi: 1.94,
  yDpi: 1.09,
  opponentDivisor: 2,
};

const STANDARD: SprocketConstants = {
  goals: 0.77,
  assists: 0.53,
  saves: 1.24,
  shots: 2.43,
  xOpi: 2.0,
  yOpi: 1.69,
  xDpi: 1.96,
  yDpi: 0.93,
  opponentDivisor: 3,
};

function logistic(raw: number, x: number, y: number): number {
  return 100 / (1 + Math.exp(BETA * ((raw - x) / y)));
}

export function calculateMvpr(player: ReplayPlayerStats): number {
  return player.goals + 0.75 * player.assists + 0.6 * player.saves + player.shots / 3;
}

function sprocketConstants(teamSize: number): SprocketConstants | null {
  if (teamSize === 1 || teamSize === 2) return DOUBLES;
  if (teamSize === 3) return STANDARD;
  return null;
}

export function calculateOpi(
  player: ReplayPlayerStats,
  teamSize: number,
): number | null {
  const constants = sprocketConstants(teamSize);
  if (!constants) return null;

  const raw =
    player.goals / constants.goals +
    0.8 * (player.assists / constants.assists) +
    0.2 * (player.shots / constants.shots);

  return logistic(raw, constants.xOpi, constants.yOpi);
}

export function calculateDpi(
  player: ReplayPlayerStats,
  teamSize: number,
  goalsAgainst: number,
  shotsAgainst: number,
): number | null {
  const constants = sprocketConstants(teamSize);
  if (!constants) return null;

  const opponentGoalsPerPlayer = goalsAgainst / constants.opponentDivisor;
  const opponentShotsPerPlayer = shotsAgainst / constants.opponentDivisor;

  const raw =
    1.1 * (2 - opponentGoalsPerPlayer / constants.goals) +
    0.5 * (player.saves / constants.saves) +
    0.4 * (2 - opponentShotsPerPlayer / constants.shots);

  return logistic(raw, constants.xDpi, constants.yDpi);
}

export function rateReplayPlayers(
  players: ReplayPlayerStats[],
  teamSize: number,
): RatedReplayPlayer[] {
  const totals = new Map<0 | 1, {goals: number; shots: number}>([
    [0, {goals: 0, shots: 0}],
    [1, {goals: 0, shots: 0}],
  ]);

  for (const player of players) {
    const team = totals.get(player.team)!;
    team.goals += player.goals;
    team.shots += player.shots;
  }

  return players.map(player => {
    const opponent = totals.get(player.team === 0 ? 1 : 0)!;
    const mvpr = calculateMvpr(player);
    const opi = calculateOpi(player, teamSize);
    const dpi = calculateDpi(player, teamSize, opponent.goals, opponent.shots);

    return {
      ...player,
      goalsAgainst: opponent.goals,
      shotsAgainst: opponent.shots,
      mvpr,
      opi,
      dpi,
      gpi: opi === null || dpi === null ? null : (opi + dpi) / 2,
    };
  });
}
