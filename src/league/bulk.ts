import type {RawScoutingLine} from "../scouting/calculate";
import type {SprocketFranchise} from "../sprocket/franchises";
import type {FranchisePlayer} from "../sprocket/players";
import type {RoleUsage} from "../sprocket/role-usages";
import type {D1PreparedStatement, Env} from "../types";

export interface PreviousLeaguePlayer {
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

export interface BulkPromotionInput {
  teams: SprocketFranchise[];
  players: FranchisePlayer[];
  usages: RoleUsage[];
  scrimStats: RawScoutingLine[];
  previousPlayers: PreviousLeaguePlayer[];
  sourceHash: string;
  sourceAsOf: string | null;
  now: string;
}

function playerStateKey(player: FranchisePlayer | PreviousLeaguePlayer): string {
  if ("sprocket_player_id" in player) {
    return JSON.stringify([
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
    ]);
  }

  return JSON.stringify([
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

function changedHistory(
  previousPlayers: PreviousLeaguePlayer[],
  nextPlayers: FranchisePlayer[],
): {closeIds: string[]; insertPlayers: FranchisePlayer[]} {
  const previous = new Map(previousPlayers.map(player => [player.sprocket_player_id, player]));
  const next = new Map(nextPlayers.map(player => [player.sprocketPlayerId, player]));
  const closeIds: string[] = [];
  const insertPlayers: FranchisePlayer[] = [];

  for (const old of previousPlayers) {
    const current = next.get(old.sprocket_player_id);
    if (!current || playerStateKey(old) !== playerStateKey(current)) {
      closeIds.push(old.sprocket_player_id);
    }
  }

  for (const current of nextPlayers) {
    const old = previous.get(current.sprocketPlayerId);
    if (!old || playerStateKey(old) !== playerStateKey(current)) {
      insertPlayers.push(current);
    }
  }

  return {closeIds, insertPlayers};
}

function teamsStatement(
  env: Env,
  teams: SprocketFranchise[],
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_teams_current (
       franchise_name, franchise_code, conference, super_division, division, refreshed_at
     )
     SELECT
       json_extract(value, '$.name'),
       json_extract(value, '$.code'),
       json_extract(value, '$.conference'),
       json_extract(value, '$.superDivision'),
       json_extract(value, '$.division'),
       ?2
     FROM json_each(?1)`,
  ).bind(JSON.stringify(teams), now);
}

function playersStatement(
  env: Env,
  players: FranchisePlayer[],
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_players_current (
       sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
       game_title, franchise_name, staff_position, slot, current_scrim_points,
       eligible_through, source_as_of, refreshed_at
     )
     SELECT
       json_extract(value, '$.sprocketPlayerId'),
       json_extract(value, '$.memberId'),
       json_extract(value, '$.discordId'),
       json_extract(value, '$.name'),
       json_extract(value, '$.salary'),
       json_extract(value, '$.skillGroup'),
       json_extract(value, '$.gameId'),
       json_extract(value, '$.gameTitle'),
       json_extract(value, '$.franchise'),
       json_extract(value, '$.staffPosition'),
       json_extract(value, '$.slot'),
       COALESCE(json_extract(value, '$.currentScrimPoints'), 0),
       json_extract(value, '$.eligibleThrough'),
       json_extract(value, '$.sourceAsOf'),
       ?2
     FROM json_each(?1)`,
  ).bind(JSON.stringify(players), now);
}

function usagesStatement(
  env: Env,
  usages: RoleUsage[],
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_role_usage_current (
       team_name, season_number, league, role, doubles_uses, standard_uses,
       total_uses, source_as_of, refreshed_at
     )
     SELECT
       json_extract(value, '$.teamName'),
       json_extract(value, '$.seasonNumber'),
       json_extract(value, '$.league'),
       json_extract(value, '$.role'),
       COALESCE(json_extract(value, '$.doublesUses'), 0),
       COALESCE(json_extract(value, '$.standardUses'), 0),
       COALESCE(json_extract(value, '$.totalUses'), 0),
       json_extract(value, '$.sourceAsOf'),
       ?2
     FROM json_each(?1)`,
  ).bind(JSON.stringify(usages), now);
}

function scrimStatement(
  env: Env,
  stats: RawScoutingLine[],
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_scrim_stats_current (
       sprocket_player_id, mode, league, games, win_pct, score, sprocket, dpi, opi,
       goals, assists, saves, shots, demos, refreshed_at
     )
     SELECT
       json_extract(value, '$.sprocketPlayerId'),
       json_extract(value, '$.mode'),
       json_extract(value, '$.league'),
       COALESCE(json_extract(value, '$.games'), 0),
       json_extract(value, '$.winPct'),
       json_extract(value, '$.score'),
       json_extract(value, '$.sprocket'),
       json_extract(value, '$.dpi'),
       json_extract(value, '$.opi'),
       json_extract(value, '$.goals'),
       json_extract(value, '$.assists'),
       json_extract(value, '$.saves'),
       json_extract(value, '$.shots'),
       json_extract(value, '$.demos'),
       ?2
     FROM json_each(?1)`,
  ).bind(JSON.stringify(stats), now);
}

function historyCloseStatement(
  env: Env,
  ids: string[],
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE league_player_history
     SET valid_to = ?2
     WHERE valid_to IS NULL
       AND sprocket_player_id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(ids), now);
}

function historyInsertStatement(
  env: Env,
  players: FranchisePlayer[],
  sourceHash: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO league_player_history (
       sprocket_player_id, member_id, discord_id, name, salary, skill_group, game_id,
       game_title, franchise_name, staff_position, slot, current_scrim_points,
       eligible_through, source_as_of, source_hash, valid_from
     )
     SELECT
       json_extract(value, '$.sprocketPlayerId'),
       json_extract(value, '$.memberId'),
       json_extract(value, '$.discordId'),
       json_extract(value, '$.name'),
       json_extract(value, '$.salary'),
       json_extract(value, '$.skillGroup'),
       json_extract(value, '$.gameId'),
       json_extract(value, '$.gameTitle'),
       json_extract(value, '$.franchise'),
       json_extract(value, '$.staffPosition'),
       json_extract(value, '$.slot'),
       COALESCE(json_extract(value, '$.currentScrimPoints'), 0),
       json_extract(value, '$.eligibleThrough'),
       json_extract(value, '$.sourceAsOf'),
       ?2,
       ?3
     FROM json_each(?1)`,
  ).bind(JSON.stringify(players), sourceHash, now);
}

export async function promoteLeagueSnapshotBulk(
  env: Env,
  input: BulkPromotionInput,
): Promise<void> {
  const history = changedHistory(input.previousPlayers, input.players);
  const statements: D1PreparedStatement[] = [];

  if (history.closeIds.length > 0) {
    statements.push(historyCloseStatement(env, history.closeIds, input.now));
  }
  if (history.insertPlayers.length > 0) {
    statements.push(
      historyInsertStatement(env, history.insertPlayers, input.sourceHash, input.now),
    );
  }

  statements.push(
    env.DB.prepare("DELETE FROM league_teams_current"),
    teamsStatement(env, input.teams, input.now),
    env.DB.prepare("DELETE FROM league_players_current"),
    playersStatement(env, input.players, input.now),
    env.DB.prepare("DELETE FROM league_role_usage_current"),
    usagesStatement(env, input.usages, input.now),
    env.DB.prepare("DELETE FROM league_scrim_stats_current"),
    scrimStatement(env, input.scrimStats, input.now),
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
      input.sourceHash,
      input.now,
      input.now,
      input.sourceAsOf,
      input.teams.length,
      input.players.length,
      input.scrimStats.length,
      input.usages.length,
    ),
  );

  try {
    const results = await env.DB.batch(statements);
    const rejected = results
      .map((result, index) => ({index, result}))
      .filter(({result}) => !result.success);

    if (rejected.length > 0) {
      console.error(
        "D1 rejected league snapshot bulk promotion statements.",
        JSON.stringify(
          rejected.map(({index, result}) => ({
            statementIndex: index,
            success: result.success,
            error: "error" in result ? result.error : undefined,
            meta: "meta" in result ? result.meta : undefined,
          })),
        ),
      );
      throw new Error("D1 rejected the league snapshot bulk promotion.");
    }
  } catch (error) {
    const details =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause instanceof Error
              ? {
                  name: error.cause.name,
                  message: error.cause.message,
                  stack: error.cause.stack,
                }
              : error.cause == null
                ? undefined
                : String(error.cause),
          }
        : {value: String(error)};

    console.error(
      "League snapshot D1 batch threw.",
      JSON.stringify({
        details,
        statementCount: statements.length,
        historyCloseCount: history.closeIds.length,
        historyInsertCount: history.insertPlayers.length,
        teamCount: input.teams.length,
        playerCount: input.players.length,
        usageCount: input.usages.length,
        scrimStatCount: input.scrimStats.length,
      }),
    );
    throw error;
  }
}
