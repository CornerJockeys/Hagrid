import {fetchCsvDatasetCandidates} from "./client.ts";
import {field, integerField, numberField, sameText} from "./fields.ts";
import type {CsvRecord} from "./csv.ts";
import type {Env} from "../types";

export type MatchStatMode = "2s" | "3s";

export interface PlayerMatchGame {
  memberId: string;
  teamName: string;
  skillGroup: string | null;
  mode: MatchStatMode;
  matchId: string;
  roundId: string;
  submittedAt: string | null;
  homeWon: boolean | null;
  dpi: number | null;
  gpi: number | null;
  opi: number | null;
  goals: number | null;
  saves: number | null;
  score: number | null;
  shots: number | null;
  assists: number | null;
  goalsAgainst: number | null;
  shotsAgainst: number | null;
  demosInflicted: number | null;
  demosTaken: number | null;
}

export interface ScheduleMatch {
  matchId: string;
  fixtureId: string | null;
  matchGroupId: string | null;
  schedulingStartTime: string | null;
  schedulingEndTime: string | null;
  scheduledTime: string | null;
  home: string;
  away: string;
  league: string | null;
  mode: MatchStatMode | null;
  homeWins: number | null;
  awayWins: number | null;
  winningTeam: string | null;
}

export interface MatchStatLine {
  mode: MatchStatMode;
  games: number;
  winPct: number | null;
  score: number | null;
  gpi: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  demos: number | null;
}

export interface PlayerSeriesStat {
  matchId: string;
  mode: MatchStatMode;
  opponent: string | null;
  scheduledTime: string | null;
  result: "W" | "L" | null;
  teamWins: number | null;
  opponentWins: number | null;
  gamesPlayed: number;
  gameWins: number | null;
  gameLosses: number | null;
  winPct: number | null;
  score: number | null;
  gpi: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
}

function booleanValue(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (["true", "t", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "f", "0", "no", "n"].includes(normalized)) return false;
  return null;
}

export function normalizeMatchMode(value: string | null): MatchStatMode | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "");
  if (
    normalized === "2s" ||
    normalized === "2v2" ||
    normalized === "doubles" ||
    normalized === "double" ||
    normalized === "rl_doubles"
  ) {
    return "2s";
  }
  if (
    normalized === "3s" ||
    normalized === "3v3" ||
    normalized === "standard" ||
    normalized === "standard3v3" ||
    normalized === "rl_standard"
  ) {
    return "3s";
  }
  return null;
}

function playerGameFromRow(row: CsvRecord): PlayerMatchGame | null {
  const memberId = field(row, "member_id", "Member ID");
  const teamName = field(row, "team_name", "Team Name");
  const matchId = field(row, "match_id", "Match ID");
  const roundId = field(row, "round_id", "Round ID");
  const mode = normalizeMatchMode(field(row, "gamemode", "game_mode", "Game Mode"));

  if (!memberId || !teamName || !matchId || !roundId || !mode) return null;

  return {
    memberId,
    teamName,
    skillGroup: field(row, "skill_group", "Skill Group"),
    mode,
    matchId,
    roundId,
    submittedAt: field(row, "replays_submitted_at", "Replays Submitted At"),
    homeWon: booleanValue(field(row, "home_won", "Home Won")),
    dpi: numberField(row, "dpi", "DPI"),
    gpi: numberField(row, "gpi", "GPI"),
    opi: numberField(row, "opi", "OPI"),
    goals: numberField(row, "goals", "Goals"),
    saves: numberField(row, "saves", "Saves"),
    score: numberField(row, "score", "Score"),
    shots: numberField(row, "shots", "Shots"),
    assists: numberField(row, "assists", "Assists"),
    goalsAgainst: numberField(row, "goals_against", "Goals Against"),
    shotsAgainst: numberField(row, "shots_against", "Shots Against"),
    demosInflicted: numberField(row, "demos_inflicted", "Demos Inflicted", "demos", "Demos"),
    demosTaken: numberField(row, "demos_taken", "Demos Taken"),
  };
}

function scheduleMatchFromRow(row: CsvRecord): ScheduleMatch | null {
  const matchId = field(row, "match_id", "Match ID");
  const home = field(row, "home", "Home");
  const away = field(row, "away", "Away");
  if (!matchId || !home || !away) return null;

  return {
    matchId,
    fixtureId: field(row, "fixture_id", "Fixture ID"),
    matchGroupId: field(row, "match_group_id", "Match Group ID"),
    schedulingStartTime: field(row, "scheduling_start_time", "Scheduling Start Time"),
    schedulingEndTime: field(row, "scheduling_end_time", "Scheduling End Time"),
    scheduledTime: field(row, "scheduled_time", "Scheduled Time"),
    home,
    away,
    league: field(row, "league", "League"),
    mode: normalizeMatchMode(field(row, "game_mode", "gamemode", "Game Mode")),
    homeWins: integerField(row, "home_wins", "Home Wins"),
    awayWins: integerField(row, "away_wins", "Away Wins"),
    winningTeam: field(row, "winning_team", "Winning Team"),
  };
}

export async function getSeason20PlayerMatchGames(env: Env): Promise<PlayerMatchGame[]> {
  const rows = await fetchCsvDatasetCandidates(env, [
    "player_stats_s20",
    "s20/player_stats_s20",
  ]);
  return rows
    .map(playerGameFromRow)
    .filter((value): value is PlayerMatchGame => value !== null);
}

export async function getScheduleMatches(env: Env): Promise<ScheduleMatch[]> {
  const rows = await fetchCsvDatasetCandidates(env, [
    "matches",
    "schedules/matches",
  ]);
  return rows
    .map(scheduleMatchFromRow)
    .filter((value): value is ScheduleMatch => value !== null);
}

export async function getFranchiseSeason20MatchData(
  env: Env,
  franchiseName: string,
): Promise<{games: PlayerMatchGame[]; matches: ScheduleMatch[]}> {
  const [allGames, allMatches] = await Promise.all([
    getSeason20PlayerMatchGames(env),
    getScheduleMatches(env),
  ]);

  const games = allGames.filter(game => sameText(game.teamName, franchiseName));
  const matchIds = new Set(games.map(game => game.matchId));
  const matches = allMatches.filter(match =>
    matchIds.has(match.matchId) ||
    sameText(match.home, franchiseName) ||
    sameText(match.away, franchiseName),
  );
  return {games, matches};
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) =>
    total + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function gameWon(
  game: PlayerMatchGame,
  match: ScheduleMatch | undefined,
): boolean | null {
  if (!match || game.homeWon === null) return null;
  if (sameText(game.teamName, match.home)) return game.homeWon;
  if (sameText(game.teamName, match.away)) return !game.homeWon;
  return null;
}

export function aggregateMatchStatLines(
  games: readonly PlayerMatchGame[],
  matches: readonly ScheduleMatch[],
): MatchStatLine[] {
  const matchById = new Map(matches.map(match => [match.matchId, match]));
  const grouped = new Map<MatchStatMode, PlayerMatchGame[]>();

  for (const game of games) {
    const rows = grouped.get(game.mode) ?? [];
    rows.push(game);
    grouped.set(game.mode, rows);
  }

  return (["2s", "3s"] as MatchStatMode[])
    .filter(mode => grouped.has(mode))
    .map(mode => {
      const rows = grouped.get(mode)!;
      const outcomes = rows
        .map(game => gameWon(game, matchById.get(game.matchId)))
        .filter((value): value is boolean => value !== null);
      const wins = outcomes.filter(Boolean).length;

      return {
        mode,
        games: rows.length,
        winPct: outcomes.length > 0 ? wins / outcomes.length : null,
        score: average(rows.map(game => game.score)),
        gpi: average(rows.map(game => game.gpi)),
        dpi: average(rows.map(game => game.dpi)),
        opi: average(rows.map(game => game.opi)),
        goals: average(rows.map(game => game.goals)),
        assists: average(rows.map(game => game.assists)),
        saves: average(rows.map(game => game.saves)),
        shots: average(rows.map(game => game.shots)),
        demos: average(rows.map(game => game.demosInflicted)),
      };
    });
}

function seriesResult(
  teamName: string,
  match: ScheduleMatch | undefined,
): {result: "W" | "L" | null; teamWins: number | null; opponentWins: number | null; opponent: string | null} {
  if (!match) return {result: null, teamWins: null, opponentWins: null, opponent: null};

  const home = sameText(teamName, match.home);
  const away = sameText(teamName, match.away);
  if (!home && !away) {
    return {result: null, teamWins: null, opponentWins: null, opponent: null};
  }

  const teamWins = home ? match.homeWins : match.awayWins;
  const opponentWins = home ? match.awayWins : match.homeWins;
  const opponent = home ? match.away : match.home;

  let result: "W" | "L" | null = null;
  if (teamWins !== null && opponentWins !== null && teamWins !== opponentWins) {
    result = teamWins > opponentWins ? "W" : "L";
  } else if (match.winningTeam && !/not played|unavailable/i.test(match.winningTeam)) {
    result = sameText(match.winningTeam, teamName) ? "W" : "L";
  }

  return {result, teamWins, opponentWins, opponent};
}

export function aggregatePlayerSeries(
  games: readonly PlayerMatchGame[],
  matches: readonly ScheduleMatch[],
): PlayerSeriesStat[] {
  const matchById = new Map(matches.map(match => [match.matchId, match]));
  const grouped = new Map<string, PlayerMatchGame[]>();

  for (const game of games) {
    const key = `${game.matchId}|${game.mode}`;
    const rows = grouped.get(key) ?? [];
    rows.push(game);
    grouped.set(key, rows);
  }

  return [...grouped.values()]
    .map(rows => {
      const first = rows[0];
      const match = matchById.get(first.matchId);
      const outcomes = rows
        .map(game => gameWon(game, match))
        .filter((value): value is boolean => value !== null);
      const gameWins = outcomes.length > 0 ? outcomes.filter(Boolean).length : null;
      const gameLosses = outcomes.length > 0 ? outcomes.length - (gameWins ?? 0) : null;
      const result = seriesResult(first.teamName, match);

      return {
        matchId: first.matchId,
        mode: first.mode,
        opponent: result.opponent,
        scheduledTime:
          match?.scheduledTime ??
          match?.schedulingStartTime ??
          first.submittedAt,
        result: result.result,
        teamWins: result.teamWins,
        opponentWins: result.opponentWins,
        gamesPlayed: rows.length,
        gameWins,
        gameLosses,
        winPct: outcomes.length > 0 ? (gameWins ?? 0) / outcomes.length : null,
        score: average(rows.map(game => game.score)),
        gpi: average(rows.map(game => game.gpi)),
        dpi: average(rows.map(game => game.dpi)),
        opi: average(rows.map(game => game.opi)),
        goals: sum(rows.map(game => game.goals)),
        assists: sum(rows.map(game => game.assists)),
        saves: sum(rows.map(game => game.saves)),
        shots: sum(rows.map(game => game.shots)),
        demos: sum(rows.map(game => game.demosInflicted)),
      };
    })
    .sort((left, right) => {
      const leftTime = left.scheduledTime ? Date.parse(left.scheduledTime) : Number.NaN;
      const rightTime = right.scheduledTime ? Date.parse(right.scheduledTime) : Number.NaN;
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return Number(right.matchId) - Number(left.matchId);
    });
}
