import {getCachedGuildConfig} from "../config-cache";
import {CURRENT_MLE_SEASON} from "../season-policy";
import {getFranchisePlayers, type FranchisePlayer} from "../sprocket/players";
import {getFranchiseRoleUsagesForSeason, type RoleUsage} from "../sprocket/role-usages";
import type {D1PreparedStatement, Env} from "../types";
import {
  completeSyncStatement,
  createSyncRun,
  getCurrentPlayers,
  markSyncRunFailed,
  type CurrentPlayerRow,
  type SyncTrigger,
} from "./db";

export interface PlayerChange {
  playerId: string;
  playerName: string;
  type: "joined" | "left" | "slot" | "salary" | "eligibility" | "scrim_points" | "name";
  previousValue: string | null;
  newValue: string | null;
}

export interface SyncSummary {
  runId: string;
  franchiseName: string;
  franchiseCode: string | null;
  playerCount: number;
  usageCount: number;
  usageSeason: number | null;
  changes: PlayerChange[];
}

export class FranchiseSyncError extends Error {
  readonly runId: string;

  constructor(runId: string, message: string) {
    super(message);
    this.name = "FranchiseSyncError";
    this.runId = runId;
  }
}

function stringValue(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function buildChanges(
  previousPlayers: CurrentPlayerRow[],
  nextPlayers: FranchisePlayer[],
): PlayerChange[] {
  const previous = new Map(previousPlayers.map(player => [player.sprocket_player_id, player]));
  const next = new Map(nextPlayers.map(player => [player.sprocketPlayerId, player]));
  const changes: PlayerChange[] = [];

  for (const player of nextPlayers) {
    const old = previous.get(player.sprocketPlayerId);
    if (!old) {
      changes.push({
        playerId: player.sprocketPlayerId,
        playerName: player.name,
        type: "joined",
        previousValue: null,
        newValue: player.slot,
      });
      continue;
    }

    if (old.name !== player.name) {
      changes.push({
        playerId: player.sprocketPlayerId,
        playerName: player.name,
        type: "name",
        previousValue: old.name,
        newValue: player.name,
      });
    }

    if ((old.slot ?? null) !== (player.slot ?? null)) {
      changes.push({
        playerId: player.sprocketPlayerId,
        playerName: player.name,
        type: "slot",
        previousValue: old.slot,
        newValue: player.slot,
      });
    }

    if ((old.salary ?? null) !== (player.salary ?? null)) {
      changes.push({
        playerId: player.sprocketPlayerId,
        playerName: player.name,
        type: "salary",
        previousValue: stringValue(old.salary),
        newValue: stringValue(player.salary),
      });
    }

    if ((old.eligible_through ?? null) !== (player.eligibleThrough ?? null)) {
      changes.push({
        playerId: player.sprocketPlayerId,
        playerName: player.name,
        type: "eligibility",
        previousValue: old.eligible_through,
        newValue: player.eligibleThrough,
      });
    }

    if (old.current_scrim_points !== player.currentScrimPoints) {
      changes.push({
        playerId: player.sprocketPlayerId,
        playerName: player.name,
        type: "scrim_points",
        previousValue: stringValue(old.current_scrim_points),
        newValue: stringValue(player.currentScrimPoints),
      });
    }
  }

  for (const player of previousPlayers) {
    if (next.has(player.sprocket_player_id)) continue;
    changes.push({
      playerId: player.sprocket_player_id,
      playerName: player.name,
      type: "left",
      previousValue: player.slot,
      newValue: null,
    });
  }

  return changes;
}

function playerInsert(
  env: Env,
  guildId: string,
  runId: string,
  player: FranchisePlayer,
): D1PreparedStatement {
  return env.DB
    .prepare(
      `INSERT INTO franchise_players_current (
         guild_id, sprocket_player_id, member_id, discord_id, name, salary, skill_group,
         game_id, game_title, franchise_name, staff_position, slot, current_scrim_points,
         eligible_through, source_as_of, last_sync_run_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      guildId,
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
      runId,
    );
}

function usageInsert(
  env: Env,
  guildId: string,
  runId: string,
  usage: RoleUsage,
): D1PreparedStatement {
  return env.DB
    .prepare(
      `INSERT INTO role_usage_current (
         guild_id, season_number, league, role, doubles_uses, standard_uses,
         total_uses, source_as_of, last_sync_run_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      guildId,
      usage.seasonNumber,
      usage.league,
      usage.role,
      usage.doublesUses,
      usage.standardUses,
      usage.totalUses,
      usage.sourceAsOf,
      runId,
    );
}

function rosterStatements(
  env: Env,
  guildId: string,
  runId: string,
  previousPlayers: CurrentPlayerRow[],
  nextPlayers: FranchisePlayer[],
): D1PreparedStatement[] {
  const previous = new Map(previousPlayers.map(player => [player.sprocket_player_id, player]));
  const next = new Map(nextPlayers.map(player => [player.sprocketPlayerId, player]));
  const statements: D1PreparedStatement[] = [];

  for (const old of previousPlayers) {
    const current = next.get(old.sprocket_player_id);
    if (current && (old.slot ?? null) === (current.slot ?? null)) continue;

    statements.push(
      env.DB
        .prepare(
          `UPDATE roster_assignments
           SET ended_run_id = ?, ended_at = CURRENT_TIMESTAMP
           WHERE guild_id = ? AND sprocket_player_id = ? AND ended_run_id IS NULL`,
        )
        .bind(runId, guildId, old.sprocket_player_id),
    );
  }

  for (const current of nextPlayers) {
    const old = previous.get(current.sprocketPlayerId);
    if (old && (old.slot ?? null) === (current.slot ?? null)) continue;

    statements.push(
      env.DB
        .prepare(
          `INSERT INTO roster_assignments (
             guild_id, sprocket_player_id, player_name, slot, started_run_id
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(guildId, current.sprocketPlayerId, current.name, current.slot, runId),
    );
  }

  return statements;
}

function changeStatements(
  env: Env,
  guildId: string,
  runId: string,
  changes: PlayerChange[],
): D1PreparedStatement[] {
  return changes.map(change =>
    env.DB
      .prepare(
        `INSERT INTO player_changes (
           guild_id, run_id, sprocket_player_id, player_name, change_type,
           previous_value, new_value
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        guildId,
        runId,
        change.playerId,
        change.playerName,
        change.type,
        change.previousValue,
        change.newValue,
      ),
  );
}

async function promote(
  env: Env,
  guildId: string,
  runId: string,
  previousPlayers: CurrentPlayerRow[],
  players: FranchisePlayer[],
  usages: RoleUsage[],
  changes: PlayerChange[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM franchise_players_current WHERE guild_id = ?").bind(guildId),
    ...players.map(player => playerInsert(env, guildId, runId, player)),
    env.DB.prepare("DELETE FROM role_usage_current WHERE guild_id = ?").bind(guildId),
    ...usages.map(usage => usageInsert(env, guildId, runId, usage)),
    ...rosterStatements(env, guildId, runId, previousPlayers, players),
    ...changeStatements(env, guildId, runId, changes),
    completeSyncStatement(env.DB, runId, players.length, usages.length, changes.length),
  ];

  const results = await env.DB.batch(statements);
  if (results.some(result => !result.success)) {
    throw new Error("D1 rejected one or more statements while promoting the sync.");
  }
}

export async function runFranchiseSync(
  env: Env,
  guildId: string,
  trigger: SyncTrigger,
  triggeredBy: string | null = null,
): Promise<SyncSummary> {
  const config = await getCachedGuildConfig(env, guildId);
  if (!config) {
    throw new Error("No franchise is configured for this Discord server.");
  }

  const runId = crypto.randomUUID();
  await createSyncRun(
    env.DB,
    runId,
    guildId,
    trigger,
    triggeredBy,
    config.franchise_name,
    config.franchise_code,
  );

  try {
    const [players, usages, previousPlayers] = await Promise.all([
      getFranchisePlayers(env, config.franchise_name),
      getFranchiseRoleUsagesForSeason(env, config.franchise_name, CURRENT_MLE_SEASON),
      getCurrentPlayers(env.DB, guildId),
    ]);

    if (players.length === 0) {
      throw new Error(
        `The players dataset returned no Rocket League players for ${config.franchise_name}.`,
      );
    }

    const changes = buildChanges(previousPlayers, players);
    await promote(env, guildId, runId, previousPlayers, players, usages, changes);

    return {
      runId,
      franchiseName: config.franchise_name,
      franchiseCode: config.franchise_code,
      playerCount: players.length,
      usageCount: usages.length,
      usageSeason: usages.length > 0 ? usages[0].seasonNumber : null,
      changes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markSyncRunFailed(env.DB, runId, message);
    throw new FranchiseSyncError(runId, message);
  }
}
