import type {D1Database} from "../types";

export interface LeagueTeamRow {
  franchise_name: string;
  franchise_code: string | null;
  conference: string | null;
  super_division: string | null;
  division: string | null;
  refreshed_at: string;
}

export interface LeaguePlayerRow {
  sprocket_player_id: string;
  member_id: string | null;
  discord_id: string | null;
  name: string;
  salary: number | null;
  skill_group: string | null;
  game_id: string | null;
  game_title: string | null;
  franchise_name: string;
  staff_position: string | null;
  slot: string | null;
  current_scrim_points: number;
  eligible_through: string | null;
  source_as_of: string | null;
  refreshed_at: string;
}

export interface LeagueUsageRow {
  team_name: string;
  season_number: number;
  league: string;
  role: string;
  doubles_uses: number;
  standard_uses: number;
  total_uses: number;
  source_as_of: string | null;
  refreshed_at: string;
}

export interface LeagueScrimStatRow {
  sprocket_player_id: string;
  mode: "2s" | "3s";
  league: string | null;
  games: number;
  win_pct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  demos: number | null;
  refreshed_at: string;
}

export interface LeagueSnapshotInfo {
  source_hash: string;
  refreshed_at: string;
  checked_at: string;
  source_as_of: string | null;
  team_count: number;
  player_count: number;
  scrim_stat_count: number;
  usage_count: number;
}

const CURRENT_PLAYER_UNION = `
  SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
         game_title, franchise_name, staff_position, slot, current_scrim_points,
         eligible_through, source_as_of, refreshed_at
  FROM league_players_current
  UNION ALL
  SELECT f.sprocket_player_id, f.member_id, f.discord_id, f.name, f.salary, f.skill_group,
         f.game_id, f.game_title, f.franchise_name, f.staff_position, f.slot,
         f.current_scrim_points, f.eligible_through, f.source_as_of,
         COALESCE(f.source_as_of, '') AS refreshed_at
  FROM franchise_players_current f
  WHERE NOT EXISTS (
    SELECT 1 FROM league_players_current r
    WHERE r.sprocket_player_id = f.sprocket_player_id
  )
    AND f.guild_id = (
      SELECT MIN(f2.guild_id)
      FROM franchise_players_current f2
      WHERE f2.sprocket_player_id = f.sprocket_player_id
    )
  UNION ALL
  SELECT p.sprocket_player_id, NULL AS member_id, NULL AS discord_id, p.name, p.salary,
         p.league AS skill_group, NULL AS game_id, 'Rocket League' AS game_title,
         p.status AS franchise_name, NULL AS staff_position, NULL AS slot,
         0 AS current_scrim_points, NULL AS eligible_through, NULL AS source_as_of,
         p.refreshed_at
  FROM prospect_pool_current p
  WHERE NOT EXISTS (
    SELECT 1 FROM league_players_current r
    WHERE r.sprocket_player_id = p.sprocket_player_id
  )
    AND NOT EXISTS (
      SELECT 1 FROM franchise_players_current f
      WHERE f.sprocket_player_id = p.sprocket_player_id
    )`;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function getLeagueSnapshotInfo(db: D1Database): Promise<LeagueSnapshotInfo | null> {
  return db.prepare(
    `SELECT source_hash, refreshed_at, checked_at, source_as_of, team_count, player_count,
            scrim_stat_count, usage_count
     FROM league_snapshot_state
     WHERE singleton = 1`,
  ).first<LeagueSnapshotInfo>();
}

export async function getAllLeagueTeams(db: D1Database): Promise<LeagueTeamRow[]> {
  const result = await db.prepare(
    `SELECT franchise_name, franchise_code, conference, super_division, division, refreshed_at
     FROM league_teams_current
     ORDER BY franchise_name COLLATE NOCASE`,
  ).all<LeagueTeamRow>();
  return result.results;
}

export async function getAllLeaguePlayers(db: D1Database): Promise<LeaguePlayerRow[]> {
  const result = await db.prepare(
    `SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
            game_title, franchise_name, staff_position, slot, current_scrim_points,
            eligible_through, source_as_of, refreshed_at
     FROM league_players_current
     ORDER BY franchise_name COLLATE NOCASE, skill_group COLLATE NOCASE,
              slot COLLATE NOCASE, name COLLATE NOCASE`,
  ).all<LeaguePlayerRow>();
  return result.results;
}

export async function getAllLeagueUsage(db: D1Database): Promise<LeagueUsageRow[]> {
  const result = await db.prepare(
    `SELECT team_name, season_number, league, role, doubles_uses, standard_uses,
            total_uses, source_as_of, refreshed_at
     FROM league_role_usage_current
     ORDER BY team_name COLLATE NOCASE, league COLLATE NOCASE, role COLLATE NOCASE`,
  ).all<LeagueUsageRow>();
  return result.results;
}

export async function getAllLeagueScrimStats(db: D1Database): Promise<LeagueScrimStatRow[]> {
  const result = await db.prepare(
    `SELECT sprocket_player_id, mode, league, games, win_pct, score, sprocket, dpi, opi,
            goals, assists, saves, shots, demos, refreshed_at
     FROM league_scrim_stats_current
     ORDER BY sprocket_player_id, mode`,
  ).all<LeagueScrimStatRow>();
  return result.results;
}

export async function searchLeagueTeams(
  db: D1Database,
  query: string,
  limit = 25,
): Promise<LeagueTeamRow[]> {
  const needle = `%${query.trim().toLocaleLowerCase("en-US")}%`;
  const result = await db.prepare(
    `SELECT franchise_name, franchise_code, conference, super_division, division, refreshed_at
     FROM league_teams_current
     WHERE LOWER(franchise_name) LIKE ? OR LOWER(COALESCE(franchise_code, '')) LIKE ?
     ORDER BY franchise_name COLLATE NOCASE
     LIMIT ?`,
  ).bind(needle, needle, limit).all<LeagueTeamRow>();
  return result.results;
}

export async function resolveLeagueTeam(
  db: D1Database,
  requested: string,
): Promise<LeagueTeamRow | null> {
  const normalized = normalize(requested);
  const exact = await db.prepare(
    `SELECT franchise_name, franchise_code, conference, super_division, division, refreshed_at
     FROM league_teams_current
     WHERE LOWER(franchise_name) = ? OR LOWER(COALESCE(franchise_code, '')) = ?
     ORDER BY franchise_name COLLATE NOCASE
     LIMIT 1`,
  ).bind(normalized, normalized).first<LeagueTeamRow>();
  if (exact) return exact;

  const suggestions = await searchLeagueTeams(db, requested, 2);
  return suggestions.length === 1 ? suggestions[0] : null;
}

export async function getLeagueTeamPlayers(
  db: D1Database,
  franchiseName: string,
): Promise<LeaguePlayerRow[]> {
  const result = await db.prepare(
    `SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
            game_title, franchise_name, staff_position, slot, current_scrim_points,
            eligible_through, source_as_of, refreshed_at
     FROM league_players_current
     WHERE LOWER(franchise_name) = LOWER(?)
     ORDER BY skill_group COLLATE NOCASE, slot COLLATE NOCASE, name COLLATE NOCASE`,
  ).bind(franchiseName).all<LeaguePlayerRow>();
  return result.results;
}

export async function searchLeaguePlayers(
  db: D1Database,
  query: string,
  limit = 25,
): Promise<LeaguePlayerRow[]> {
  const needle = `%${query.trim().toLocaleLowerCase("en-US")}%`;
  const result = await db.prepare(
    `WITH current_players AS (${CURRENT_PLAYER_UNION})
     SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
            game_title, franchise_name, staff_position, slot, current_scrim_points,
            eligible_through, source_as_of, refreshed_at
     FROM current_players
     WHERE LOWER(name) LIKE ? OR LOWER(sprocket_player_id) LIKE ?
     ORDER BY name COLLATE NOCASE, franchise_name COLLATE NOCASE
     LIMIT ?`,
  ).bind(needle, needle, limit).all<LeaguePlayerRow>();
  return result.results;
}

export async function resolveLeaguePlayer(
  db: D1Database,
  requested: string,
): Promise<LeaguePlayerRow | null> {
  const exactId = await db.prepare(
    `WITH current_players AS (${CURRENT_PLAYER_UNION})
     SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
            game_title, franchise_name, staff_position, slot, current_scrim_points,
            eligible_through, source_as_of, refreshed_at
     FROM current_players
     WHERE sprocket_player_id = ?
     LIMIT 1`,
  ).bind(requested.trim()).first<LeaguePlayerRow>();
  if (exactId) return exactId;

  const exactName = await db.prepare(
    `WITH current_players AS (${CURRENT_PLAYER_UNION})
     SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
            game_title, franchise_name, staff_position, slot, current_scrim_points,
            eligible_through, source_as_of, refreshed_at
     FROM current_players
     WHERE LOWER(name) = ?
     ORDER BY franchise_name COLLATE NOCASE
     LIMIT 2`,
  ).bind(normalize(requested)).all<LeaguePlayerRow>();
  if (exactName.results.length === 1) return exactName.results[0];

  const suggestions = await searchLeaguePlayers(db, requested, 2);
  return suggestions.length === 1 ? suggestions[0] : null;
}

export async function getTeamRoleUsage(
  db: D1Database,
  franchiseName: string,
  seasonNumber: number,
): Promise<LeagueUsageRow[]> {
  const result = await db.prepare(
    `SELECT team_name, season_number, league, role, doubles_uses, standard_uses,
            total_uses, source_as_of, refreshed_at
     FROM league_role_usage_current
     WHERE LOWER(team_name) = LOWER(?) AND season_number = ?
     ORDER BY league COLLATE NOCASE, role COLLATE NOCASE`,
  ).bind(franchiseName, seasonNumber).all<LeagueUsageRow>();
  return result.results;
}

export async function getTeamScrimStats(
  db: D1Database,
  franchiseName: string,
): Promise<LeagueScrimStatRow[]> {
  const result = await db.prepare(
    `SELECT s.sprocket_player_id, s.mode, s.league, s.games, s.win_pct, s.score,
            s.sprocket, s.dpi, s.opi, s.goals, s.assists, s.saves, s.shots, s.demos,
            s.refreshed_at
     FROM league_scrim_stats_current s
     INNER JOIN league_players_current p
       ON p.sprocket_player_id = s.sprocket_player_id
     WHERE LOWER(p.franchise_name) = LOWER(?)
     ORDER BY p.skill_group COLLATE NOCASE, p.slot COLLATE NOCASE, s.mode`,
  ).bind(franchiseName).all<LeagueScrimStatRow>();
  return result.results;
}

export async function getPlayerScrimStats(
  db: D1Database,
  sprocketPlayerId: string,
): Promise<LeagueScrimStatRow[]> {
  const result = await db.prepare(
    `SELECT sprocket_player_id, mode, league, games, win_pct, score, sprocket, dpi, opi,
            goals, assists, saves, shots, demos, refreshed_at
     FROM league_scrim_stats_current
     WHERE sprocket_player_id = ?
     UNION ALL
     SELECT s.sprocket_player_id, s.mode, s.league, s.games, s.win_pct, s.score,
            s.sprocket, s.dpi, s.opi, s.goals, s.assists, s.saves, s.shots, s.demos,
            s.refreshed_at
     FROM scouting_players_current s
     WHERE s.sprocket_player_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM league_scrim_stats_current l
         WHERE l.sprocket_player_id = s.sprocket_player_id AND l.mode = s.mode
       )
     ORDER BY mode`,
  ).bind(sprocketPlayerId, sprocketPlayerId).all<LeagueScrimStatRow>();
  return result.results;
}
