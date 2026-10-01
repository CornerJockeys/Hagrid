import {getFranchises, type SprocketFranchise} from "../sprocket/franchises";
import {getRocketLeaguePlayers, type FranchisePlayer} from "../sprocket/players";
import {getRoleUsagesForSeason, type RoleUsage} from "../sprocket/role-usages";
import {getScoutingStatLines} from "../sprocket/scouting";
import {CURRENT_MLE_SEASON} from "../season-policy";
import type {D1PreparedStatement, Env, ScheduledEventLike} from "../types";
import type {RawScoutingLine} from "../scouting/calculate";

export const LEAGUE_REFRESH_CRON = "20 * * * *";

interface LeagueSnapshotStateRow {
  source_hash: string;
  refreshed_at: string;
  checked_at: string;
  source_as_of: string | null;
  team_count: number;
  player_count: number;
  scrim_stat_count: number;
  usage_count: number;
}

interface CurrentLeaguePlayerRow {
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
}

export interface LeagueRefreshSummary {
  changed: boolean;
  sourceHash: string;
  refreshedAt: string;
  checkedAt: string;
  sourceAsOf: string | null;
  teamCount: number;
  playerCount: number;
  scrimStatCount: number;
  usageCount: number;
}

// Source timestamps are deliberately excluded. They describe freshness, not a
// roster-state change, so an hourly as_of bump must not create history rows.
function playerKey(player: FranchisePlayer | CurrentLeaguePlayerRow): string {
  const isCurrent = "sprocket_player_id" in player;
  return JSON.stringify(isCurrent
    ? [
        player.sprocket_player_id,
        player.member_id,
        player.discord_id,
        player.name,
        player.salary,
        player.skill_group,
        player.game_id,
        player.game_title,
        player.franchise_name,
        player.staff_position,
        player.slot,
        player.current_scrim_points,
        player.eligible_through,
      ]
    : [
        player.sprocketPlayerId,
        player.memberId,
        player.discordId,
        player.name,
        player.salary,
        player.skillGroup,
        player.gameId,
        player.gameTitle,
        player.franchise,
        player.staffPosition,
        player.slot,
        player.currentScrimPoints,
        player.eligibleThrough,
      ]);
}

function normalizeHashInput(
  teams: SprocketFranchise[],
  players: FranchisePlayer[],
  usages: RoleUsage[],
  scrimStats: RawScoutingLine[],
): string {
  return JSON.stringify({
    season: CURRENT_MLE_SEASON,
    teams: [...teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(team => [team.name, team.code, team.conference, team.superDivision, team.division]),
    players: [...players]
      .sort((a, b) => a.sprocketPlayerId.localeCompare(b.sprocketPlayerId))
      .map(player => JSON.parse(playerKey(player))),
    usages: [...usages]
      .sort((a, b) =>
        a.teamName.localeCompare(b.teamName) ||
        a.league.localeCompare(b.league) ||
        a.role.localeCompare(b.role),
      )
      .map(value => [
        value.teamName,
        value.seasonNumber,
        value.league,
        value.role,
        value.doublesUses,
        value.standardUses,
        value.totalUses,
      ]),
    scrimStats: [...scrimStats]
      .sort((a, b) => a.sprocketPlayerId.localeCompare(b.sprocketPlayerId) || a.mode.localeCompare(b.mode))
      .map(value => [
        value.sprocketPlayerId,
        value.mode,
        value.league,
        value.games,
        value.winPct,
        value.score,
        value.sprocket,
        value.dpi,
        value.opi,
        value.goals,
        value.assists,
        value.saves,
        value.shots,
        value.demos,
      ]),
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function latestSourceAsOf(players: FranchisePlayer[], usages: RoleUsage[], fallback: string): string {
  const values = [
    ...players.map(value => value.sourceAsOf),
    ...usages.map(value => value.sourceAsOf),
  ].filter((value): value is string => Boolean(value));

  let best: {raw: string; time: number} | null = null;
  for (const raw of values) {
    const time = Date.parse(raw);
    if (!Number.isFinite(time)) continue;
    if (!best || time > best.time) best = {raw, time};
  }
  return best?.raw ?? fallback;
}

async function getState(env: Env): Promise<LeagueSnapshotStateRow | null> {
  return env.DB.prepare(
    `SELECT source_hash, refreshed_at, checked_at, source_as_of, team_count, player_count,
            scrim_stat_count, usage_count
     FROM league_snapshot_state
     WHERE singleton = 1`,
  ).first<LeagueSnapshotStateRow>();
}

async function getCurrentPlayers(env: Env): Promise<CurrentLeaguePlayerRow[]> {
  const result = await env.DB.prepare(
    `SELECT sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
            game_title, franchise_name, staff_position, slot, current_scrim_points,
            eligible_through, source_as_of
     FROM league_players_current`,
  ).all<CurrentLeaguePlayerRow>();
  return result.results;
}

function teamInsert(env: Env, team: SprocketFranchise, now: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_teams_current (
       franchise_name, franchise_code, conference, super_division, division, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(team.name, team.code, team.conference, team.superDivision, team.division, now);
}

function playerInsert(env: Env, player: FranchisePlayer, now: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_players_current (
       sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
       game_title, franchise_name, staff_position, slot, current_scrim_points,
       eligible_through, source_as_of, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    player.sprocketPlayerId,
    player.memberId,
    player.discordId,
    player.name,
    player.salary,
    player.skillGroup,
    player.gameId,
    player.gameTitle,
    player.franchise,
    player.staffPosition,
    player.slot,
    player.currentScrimPoints,
    player.eligibleThrough,
    player.sourceAsOf,
    now,
  );
}

function historyInsert(
  env: Env,
  player: FranchisePlayer,
  sourceHash: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_player_history (
       sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
       game_title, franchise_name, staff_position, slot, current_scrim_points,
       eligible_through, source_as_of, source_hash, valid_from
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    player.sprocketPlayerId,
    player.memberId,
    player.discordId,
    player.name,
    player.salary,
    player.skillGroup,
    player.gameId,
    player.gameTitle,
    player.franchise,
    player.staffPosition,
    player.slot,
    player.currentScrimPoints,
    player.eligibleThrough,
    player.sourceAsOf,
    sourceHash,
    now,
  );
}

function usageInsert(env: Env, usage: RoleUsage, now: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_role_usage_current (
       team_name, season_number, league, role, doubles_uses, standard_uses,
       total_uses, source_as_of, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    usage.teamName,
    usage.seasonNumber,
    usage.league,
    usage.role,
    usage.doublesUses,
    usage.standardUses,
    usage.totalUses,
    usage.sourceAsOf,
    now,
  );
}

function scrimInsert(env: Env, stat: RawScoutingLine, now: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_scrim_stats_current (
       sprocket_player_id, mode, league, games, win_pct, score, sprocket, dpi, opi,
       goals, assists, saves, shots, demos, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    stat.sprocketPlayerId,
    stat.mode,
    stat.league,
    stat.games,
    stat.winPct,
    stat.score,
    stat.sprocket,
    stat.dpi,
    stat.opi,
    stat.goals,
    stat.assists,
    stat.saves,
    stat.shots,
    stat.demos,
    now,
  );
}

function historyStatements(
  env: Env,
  previousPlayers: CurrentLeaguePlayerRow[],
  nextPlayers: FranchisePlayer[],
  sourceHash: string,
  now: string,
): D1PreparedStatement[] {
  const previous = new Map(previousPlayers.map(player => [player.sprocket_player_id, player]));
  const next = new Map(nextPlayers.map(player => [player.sprocketPlayerId, player]));
  const statements: D1PreparedStatement[] = [];

  for (const old of previousPlayers) {
    const current = next.get(old.sprocket_player_id);
    if (current && playerKey(old) === playerKey(current)) continue;
    statements.push(
      env.DB.prepare(
        `UPDATE league_player_history
         SET valid_to = ?
         WHERE sprocket_player_id = ? AND valid_to IS NULL`,
      ).bind(now, old.sprocket_player_id),
    );
  }

  for (const current of nextPlayers) {
    const old = previous.get(current.sprocketPlayerId);
    if (old && playerKey(old) === playerKey(current)) continue;
    statements.push(historyInsert(env, current, sourceHash, now));
  }

  return statements;
}

export async function refreshLeagueSnapshot(env: Env, reason = "manual"): Promise<LeagueRefreshSummary> {
  const checkedAt = new Date().toISOString();
  const [teams, players, usages, rawScrimStats, previousPlayers] = await Promise.all([
    getFranchises(env),
    getRocketLeaguePlayers(env),
    getRoleUsagesForSeason(env, CURRENT_MLE_SEASON),
    getScoutingStatLines(env),
    getCurrentPlayers(env),
  ]);

  if (teams.length === 0) throw new Error("The Sprocket teams dataset returned no franchises.");
  if (players.length === 0) throw new Error("The Sprocket players dataset returned no Rocket League players.");

  const playerIds = new Set(players.map(player => player.sprocketPlayerId));
  const scrimStats = rawScrimStats.filter(stat => playerIds.has(stat.sprocketPlayerId));
  const sourceHash = await sha256(normalizeHashInput(teams, players, usages, scrimStats));
  const sourceAsOf = latestSourceAsOf(players, usages, checkedAt);
  const state = await getState(env);

  if (state?.source_hash === sourceHash) {
    const checked = await env.DB.prepare(
      `UPDATE league_snapshot_state SET checked_at = ?, source_as_of = ? WHERE singleton = 1`,
    ).bind(checkedAt, sourceAsOf).run();
    if (!checked.success) throw new Error("D1 rejected the league snapshot freshness update.");
    console.log(`League snapshot refresh (${reason}) found no source changes.`);
    return {
      changed: false,
      sourceHash,
      refreshedAt: state.refreshed_at,
      checkedAt,
      sourceAsOf,
      teamCount: state.team_count,
      playerCount: state.player_count,
      scrimStatCount: state.scrim_stat_count,
      usageCount: state.usage_count,
    };
  }

  const statements: D1PreparedStatement[] = [
    ...historyStatements(env, previousPlayers, players, sourceHash, checkedAt),
    env.DB.prepare("DELETE FROM league_teams_current"),
    ...teams.map(team => teamInsert(env, team, checkedAt)),
    env.DB.prepare("DELETE FROM league_players_current"),
    ...players.map(player => playerInsert(env, player, checkedAt)),
    env.DB.prepare("DELETE FROM league_role_usage_current"),
    ...usages.map(usage => usageInsert(env, usage, checkedAt)),
    env.DB.prepare("DELETE FROM league_scrim_stats_current"),
    ...scrimStats.map(stat => scrimInsert(env, stat, checkedAt)),
    env.DB.prepare(
      `INSERT INTO league_snapshot_state (
         singleton, source_hash, refreshed_at, checked_at, source_as_of, team_count,
         player_count, scrim_stat_count, usage_count
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         source_hash = excluded.source_hash,
         refreshed_at = excluded.refreshed_at,
         checked_at = excluded.checked_at,
         source_as_of = excluded.source_as_of,
         team_count = excluded.team_count,
         player_count = excluded.player_count,
         scrim_stat_count = excluded.scrim_stat_count,
         usage_count = excluded.usage_count`,
    ).bind(
      sourceHash,
      checkedAt,
      checkedAt,
      sourceAsOf,
      teams.length,
      players.length,
      scrimStats.length,
      usages.length,
    ),
  ];

  const results = await env.DB.batch(statements);
  if (results.some(result => !result.success)) {
    throw new Error("D1 rejected one or more statements while promoting the league snapshot.");
  }

  console.log(
    `League snapshot refresh (${reason}) promoted ${teams.length} teams, ${players.length} players, ` +
    `${scrimStats.length} scrim rows, and ${usages.length} S${CURRENT_MLE_SEASON} usage rows.`,
  );

  return {
    changed: true,
    sourceHash,
    refreshedAt: checkedAt,
    checkedAt,
    sourceAsOf,
    teamCount: teams.length,
    playerCount: players.length,
    scrimStatCount: scrimStats.length,
    usageCount: usages.length,
  };
}

export async function ensureLeagueSnapshot(env: Env): Promise<LeagueRefreshSummary | null> {
  const state = await getState(env);
  if (state && state.player_count > 0 && state.team_count > 0) return null;
  return refreshLeagueSnapshot(env, "cold-start");
}

export async function runScheduledLeagueRefresh(
  env: Env,
  event: ScheduledEventLike,
): Promise<void> {
  if (event.cron !== LEAGUE_REFRESH_CRON) return;
  try {
    await refreshLeagueSnapshot(env, "scheduled-hourly");
  } catch (error) {
    console.error("Hourly league snapshot refresh failed.", error);
  }
}
