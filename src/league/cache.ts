import type {RawScoutingLine} from "../scouting/calculate";
import type {SprocketFranchise} from "../sprocket/franchises";
import type {FranchisePlayer} from "../sprocket/players";
import type {RoleUsage} from "../sprocket/role-usages";
import type {Env} from "../types";
import {
  getAllLeaguePlayers,
  getAllLeagueScrimStats,
  getAllLeagueTeams,
  getAllLeagueUsage,
  getLeagueSnapshotInfo,
  type LeaguePlayerRow,
  type LeagueScrimStatRow,
  type LeagueSnapshotInfo,
  type LeagueTeamRow,
  type LeagueUsageRow,
} from "./db";

const LEAGUE_SNAPSHOT_KEY = "league:current:v1";

export interface CachedLeagueSnapshot {
  state: LeagueSnapshotInfo;
  teams: LeagueTeamRow[];
  players: LeaguePlayerRow[];
  usages: LeagueUsageRow[];
  scrimStats: LeagueScrimStatRow[];
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function validSnapshot(value: unknown): value is CachedLeagueSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedLeagueSnapshot>;
  return Boolean(
    candidate.state &&
    typeof candidate.state.source_hash === "string" &&
    Array.isArray(candidate.teams) &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.usages) &&
    Array.isArray(candidate.scrimStats),
  );
}

export async function getCachedLeagueSnapshot(
  env: Env,
): Promise<CachedLeagueSnapshot | null> {
  if (!env.HAGRID_CACHE) return null;
  try {
    const raw = await env.HAGRID_CACHE.get(LEAGUE_SNAPSHOT_KEY, "text");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return validSnapshot(parsed) ? parsed : null;
  } catch (error) {
    console.error("Failed to read league snapshot from KV.", error);
    return null;
  }
}

export async function putCachedLeagueSnapshot(
  env: Env,
  snapshot: CachedLeagueSnapshot,
): Promise<void> {
  if (!env.HAGRID_CACHE) return;
  try {
    await env.HAGRID_CACHE.put(LEAGUE_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // D1 remains authoritative. A cache write failure must not turn an otherwise
    // successful league refresh into a failed refresh.
    console.error("Failed to write league snapshot to KV.", error);
  }
}

export function leagueSnapshotFromSources(input: {
  teams: SprocketFranchise[];
  players: FranchisePlayer[];
  usages: RoleUsage[];
  scrimStats: RawScoutingLine[];
  sourceHash: string;
  sourceAsOf: string | null;
  refreshedAt: string;
  checkedAt: string;
}): CachedLeagueSnapshot {
  const teams: LeagueTeamRow[] = input.teams.map(team => ({
    franchise_name: team.name,
    franchise_code: team.code,
    conference: team.conference,
    super_division: team.superDivision,
    division: team.division,
    refreshed_at: input.refreshedAt,
  }));

  const players: LeaguePlayerRow[] = input.players.map(player => ({
    sprocket_player_id: player.sprocketPlayerId,
    member_id: player.memberId,
    discord_id: player.discordId,
    name: player.name,
    salary: player.salary,
    skill_group: player.skillGroup,
    game_id: player.gameId,
    game_title: player.gameTitle,
    franchise_name: player.franchise,
    staff_position: player.staffPosition,
    slot: player.slot,
    current_scrim_points: player.currentScrimPoints,
    eligible_through: player.eligibleThrough,
    source_as_of: player.sourceAsOf,
    refreshed_at: input.refreshedAt,
  }));

  const usages: LeagueUsageRow[] = input.usages.map(usage => ({
    team_name: usage.teamName,
    season_number: usage.seasonNumber,
    league: usage.league,
    role: usage.role,
    doubles_uses: usage.doublesUses,
    standard_uses: usage.standardUses,
    total_uses: usage.totalUses,
    source_as_of: usage.sourceAsOf,
    refreshed_at: input.refreshedAt,
  }));

  const scrimStats: LeagueScrimStatRow[] = input.scrimStats.map(stat => ({
    sprocket_player_id: stat.sprocketPlayerId,
    mode: stat.mode,
    league: stat.league,
    games: stat.games,
    win_pct: stat.winPct,
    score: stat.score,
    sprocket: stat.sprocket,
    dpi: stat.dpi,
    opi: stat.opi,
    goals: stat.goals,
    assists: stat.assists,
    saves: stat.saves,
    shots: stat.shots,
    demos: stat.demos,
    refreshed_at: input.refreshedAt,
  }));

  return {
    state: {
      source_hash: input.sourceHash,
      refreshed_at: input.refreshedAt,
      checked_at: input.checkedAt,
      source_as_of: input.sourceAsOf,
      team_count: teams.length,
      player_count: players.length,
      scrim_stat_count: scrimStats.length,
      usage_count: usages.length,
    },
    teams,
    players,
    usages,
    scrimStats,
  };
}

export async function getCurrentLeagueSnapshot(
  env: Env,
): Promise<CachedLeagueSnapshot | null> {
  const cached = await getCachedLeagueSnapshot(env);
  if (cached) return cached;

  const state = await getLeagueSnapshotInfo(env.DB);
  if (!state || state.player_count <= 0 || state.team_count <= 0) return null;

  const [teams, players, usages, scrimStats] = await Promise.all([
    getAllLeagueTeams(env.DB),
    getAllLeaguePlayers(env.DB),
    getAllLeagueUsage(env.DB),
    getAllLeagueScrimStats(env.DB),
  ]);

  const snapshot: CachedLeagueSnapshot = {state, teams, players, usages, scrimStats};
  await putCachedLeagueSnapshot(env, snapshot);
  return snapshot;
}

export function findSnapshotTeam(
  snapshot: CachedLeagueSnapshot,
  requested: string,
): LeagueTeamRow | null {
  const needle = normalize(requested);
  const exact = snapshot.teams.filter(team =>
    normalize(team.franchise_name) === needle ||
    normalize(team.franchise_code) === needle,
  );
  if (exact.length === 1) return exact[0];

  const partial = snapshot.teams.filter(team =>
    normalize(team.franchise_name).includes(needle) ||
    normalize(team.franchise_code).includes(needle),
  );
  return partial.length === 1 ? partial[0] : null;
}

export function snapshotTeamPlayers(
  snapshot: CachedLeagueSnapshot,
  franchiseName: string,
): LeaguePlayerRow[] {
  const target = normalize(franchiseName);
  return snapshot.players.filter(player => normalize(player.franchise_name) === target);
}

export function snapshotTeamUsage(
  snapshot: CachedLeagueSnapshot,
  franchiseName: string,
  seasonNumber: number,
): LeagueUsageRow[] {
  const target = normalize(franchiseName);
  return snapshot.usages.filter(usage =>
    usage.season_number === seasonNumber &&
    normalize(usage.team_name) === target,
  );
}

export function snapshotTeamScrimStats(
  snapshot: CachedLeagueSnapshot,
  franchiseName: string,
): LeagueScrimStatRow[] {
  const ids = new Set(snapshotTeamPlayers(snapshot, franchiseName).map(player => player.sprocket_player_id));
  return snapshot.scrimStats.filter(stat => ids.has(stat.sprocket_player_id));
}

export function snapshotPlayerById(
  snapshot: CachedLeagueSnapshot,
  sprocketPlayerId: string,
): LeaguePlayerRow | null {
  return snapshot.players.find(player => player.sprocket_player_id === sprocketPlayerId) ?? null;
}

export function searchSnapshotPlayers(
  snapshot: CachedLeagueSnapshot,
  query: string,
  limit = 25,
): LeaguePlayerRow[] {
  const needle = normalize(query);
  return snapshot.players
    .filter(player =>
      normalize(player.name).includes(needle) ||
      normalize(player.sprocket_player_id).includes(needle),
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en-US", {sensitivity: "base"}) ||
      left.franchise_name.localeCompare(right.franchise_name, "en-US", {sensitivity: "base"}),
    )
    .slice(0, limit);
}
