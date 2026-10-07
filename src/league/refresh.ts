import {getFranchises, type SprocketFranchise} from "../sprocket/franchises";
import {getRocketLeaguePlayers, type FranchisePlayer} from "../sprocket/players";
import {getRoleUsagesForSeason, type RoleUsage} from "../sprocket/role-usages";
import {getScoutingStatLines} from "../sprocket/scouting";
import {CURRENT_MLE_SEASON} from "../season-policy";
import type {Env, ScheduledEventLike} from "../types";
import {promoteLeagueSnapshotBulk} from "./bulk";
import type {RawScoutingLine} from "../scouting/calculate";
import {teamDivision} from "./view";

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

function canonicalLeagueScrimStats(
  players: FranchisePlayer[],
  lines: RawScoutingLine[],
): RawScoutingLine[] {
  const playerById = new Map(players.map(player => [player.sprocketPlayerId, player]));
  const grouped = new Map<string, RawScoutingLine[]>();

  for (const line of lines) {
    if (!playerById.has(line.sprocketPlayerId)) continue;
    const key = `${line.sprocketPlayerId}|${line.mode}`;
    const group = grouped.get(key) ?? [];
    group.push(line);
    grouped.set(key, group);
  }

  const selected: RawScoutingLine[] = [];
  for (const group of grouped.values()) {
    const player = playerById.get(group[0].sprocketPlayerId)!;
    const division = teamDivision(player.skillGroup);

    group.sort((left, right) => {
      const leftLeagueMatch = division !== null && left.league === division ? 1 : 0;
      const rightLeagueMatch = division !== null && right.league === division ? 1 : 0;
      return rightLeagueMatch - leftLeagueMatch || right.games - left.games;
    });

    selected.push(group[0]);
  }

  return selected.sort((left, right) =>
    left.sprocketPlayerId.localeCompare(right.sprocketPlayerId) ||
    left.mode.localeCompare(right.mode),
  );
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

  const scrimStats = canonicalLeagueScrimStats(players, rawScrimStats);
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

  await promoteLeagueSnapshotBulk(env, {
    teams,
    players,
    usages,
    scrimStats,
    previousPlayers,
    sourceHash,
    sourceAsOf,
    now: checkedAt,
  });

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
