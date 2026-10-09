import {getConfiguredGuilds} from "./db";
import {isCompetitiveSlot} from "./league/view";
import {getPlayerSeasonHistory} from "./sprocket/player-history";
import type {FranchisePlayer} from "./sprocket/players";
import type {D1Database, Env} from "./types";

export interface PlayerProfileMetadata {
  sprocketPlayerId: string;
  memberId: string | null;
  franchiseName: string;
  joinedDate: string | null;
  seasonsPlayed: number | null;
  seasons: string[];
  updatedAt: string;
}

interface PlayerProfileMetadataRow {
  sprocket_player_id: string;
  member_id: string | null;
  franchise_name: string;
  joined_date: string | null;
  seasons_played: number | null;
  seasons_json: string | null;
  updated_at: string;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function rowToMetadata(row: PlayerProfileMetadataRow): PlayerProfileMetadata {
  let seasons: string[] = [];
  try {
    const parsed = row.seasons_json ? JSON.parse(row.seasons_json) : [];
    if (Array.isArray(parsed)) seasons = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    seasons = [];
  }
  return {
    sprocketPlayerId: row.sprocket_player_id,
    memberId: row.member_id,
    franchiseName: row.franchise_name,
    joinedDate: row.joined_date,
    seasonsPlayed: row.seasons_played,
    seasons,
    updatedAt: row.updated_at,
  };
}

export async function getPlayerProfileMetadata(
  db: D1Database,
  sprocketPlayerIds: readonly string[],
): Promise<Map<string, PlayerProfileMetadata>> {
  const ids = [...new Set(sprocketPlayerIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const result = await db.prepare(
    `SELECT sprocket_player_id, member_id, franchise_name, joined_date, seasons_played,
            seasons_json, updated_at
     FROM player_profile_metadata
     WHERE sprocket_player_id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(ids)).all<PlayerProfileMetadataRow>();

  return new Map(result.results.map(row => {
    const metadata = rowToMetadata(row);
    return [metadata.sprocketPlayerId, metadata] as const;
  }));
}

function rosterSignature(players: Array<{sprocketPlayerId: string; slot: string | null; memberId: string | null}>): string {
  return players
    .filter(player => isCompetitiveSlot(player.slot))
    .map(player => [player.sprocketPlayerId, player.memberId ?? "", player.slot ?? ""].join("|"))
    .sort()
    .join("\n");
}

function previousSignature(players: Array<{
  sprocket_player_id: string;
  member_id: string | null;
  franchise_name: string;
  slot: string | null;
}>): string {
  return players
    .filter(player => isCompetitiveSlot(player.slot))
    .map(player => [player.sprocket_player_id, player.member_id ?? "", player.slot ?? ""].join("|"))
    .sort()
    .join("\n");
}

export async function refreshConfiguredFranchisePlayerMetadata(
  env: Env,
  currentPlayers: FranchisePlayer[],
  previousPlayers: Array<{
    sprocket_player_id: string;
    member_id: string | null;
    franchise_name: string;
    slot: string | null;
  }>,
  now: string,
): Promise<void> {
  const configs = await getConfiguredGuilds(env.DB);
  const configured = [...new Set(configs.map(config => normalize(config.franchise_name)))];
  if (configured.length === 0) return;

  const targets: FranchisePlayer[] = [];
  for (const franchise of configured) {
    const next = currentPlayers.filter(player =>
      normalize(player.franchise) === franchise && isCompetitiveSlot(player.slot),
    );
    if (next.length === 0) continue;

    const previous = previousPlayers.filter(player => normalize(player.franchise_name) === franchise);
    const existing = await getPlayerProfileMetadata(env.DB, next.map(player => player.sprocketPlayerId));
    const missing = next.some(player => !existing.has(player.sprocketPlayerId));
    const changed = rosterSignature(next) !== previousSignature(previous);
    const joinDateChanged = next.some(player =>
      existing.get(player.sprocketPlayerId)?.joinedDate !== (player.joinedDate ?? null),
    );

    if (changed || missing || joinDateChanged) targets.push(...next);
  }

  if (targets.length === 0) return;

  const unique = new Map(targets.map(player => [player.sprocketPlayerId, player]));
  const memberIds = [...new Set(
    [...unique.values()].map(player => player.memberId).filter((value): value is string => Boolean(value)),
  )];

  let seasonHistory: Awaited<ReturnType<typeof getPlayerSeasonHistory>> = [];
  try {
    seasonHistory = await getPlayerSeasonHistory(env, memberIds);
  } catch (error) {
    console.error("Historical player-season metadata refresh failed; preserving prior season counts.", error);
  }
  const seasonsByMember = new Map(seasonHistory.map(value => [value.memberId, value.seasons]));

  const statements = [...unique.values()].map(player => {
    const seasons = player.memberId ? seasonsByMember.get(player.memberId) : undefined;
    return env.DB.prepare(
      `INSERT INTO player_profile_metadata (
         sprocket_player_id, member_id, franchise_name, joined_date, seasons_played,
         seasons_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sprocket_player_id) DO UPDATE SET
         member_id = excluded.member_id,
         franchise_name = excluded.franchise_name,
         joined_date = COALESCE(excluded.joined_date, player_profile_metadata.joined_date),
         seasons_played = COALESCE(excluded.seasons_played, player_profile_metadata.seasons_played),
         seasons_json = COALESCE(excluded.seasons_json, player_profile_metadata.seasons_json),
         updated_at = excluded.updated_at`,
    ).bind(
      player.sprocketPlayerId,
      player.memberId,
      player.franchise,
      player.joinedDate,
      seasons ? seasons.length : null,
      seasons ? JSON.stringify(seasons) : null,
      now,
    );
  });

  if (statements.length > 0) await env.DB.batch(statements);
}
