import type {ProspectIdentity, ScoutingRecord} from "./calculate";
import type {D1PreparedStatement, Env} from "../types";

export interface ScoutingBulkInput {
  identities: ProspectIdentity[];
  records: ScoutingRecord[];
  sourceHash: string;
  algorithmVersion: string;
  now: string;
}

function poolStatement(
  env: Env,
  identities: ProspectIdentity[],
  sourceHash: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO prospect_pool_current (
       sprocket_player_id, league, status, name, salary, source_hash, refreshed_at
     )
     SELECT
       json_extract(value, '$.sprocketPlayerId'),
       json_extract(value, '$.league'),
       json_extract(value, '$.status'),
       json_extract(value, '$.name'),
       json_extract(value, '$.salary'),
       ?2,
       ?3
     FROM json_each(?1)`,
  ).bind(JSON.stringify(identities), sourceHash, now);
}

function currentStatement(
  env: Env,
  records: ScoutingRecord[],
  sourceHash: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO scouting_players_current (
       sprocket_player_id, mode, league, status, name, salary, games,
       win_pct, score, sprocket, dpi, opi, goals, assists, saves, shots,
       shot_pct, demos, eff_salary, temp, temp_score, bucket, main_role,
       alt_role, role_confidence, flags, source_hash, refreshed_at
     )
     SELECT
       json_extract(value, '$.sprocketPlayerId'),
       json_extract(value, '$.mode'),
       json_extract(value, '$.league'),
       json_extract(value, '$.status'),
       json_extract(value, '$.name'),
       json_extract(value, '$.salary'),
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
       json_extract(value, '$.shotPct'),
       json_extract(value, '$.demos'),
       json_extract(value, '$.effSalary'),
       json_extract(value, '$.temp'),
       json_extract(value, '$.tempScore'),
       json_extract(value, '$.bucket'),
       json_extract(value, '$.mainRole'),
       json_extract(value, '$.altRole'),
       json_extract(value, '$.roleConfidence'),
       COALESCE(json_extract(value, '$.flags'), ''),
       ?2,
       ?3
     FROM json_each(?1)`,
  ).bind(JSON.stringify(records), sourceHash, now);
}

export async function promoteScoutingSnapshotBulk(
  env: Env,
  input: ScoutingBulkInput,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM prospect_pool_current"),
    poolStatement(env, input.identities, input.sourceHash, input.now),
    env.DB.prepare("DELETE FROM scouting_players_current"),
    currentStatement(env, input.records, input.sourceHash, input.now),
    env.DB.prepare(
      `INSERT INTO scouting_refresh_state (
         singleton, source_hash, algorithm_version, refreshed_at, checked_at, prospect_count, row_count
       ) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         source_hash = excluded.source_hash,
         algorithm_version = excluded.algorithm_version,
         refreshed_at = excluded.refreshed_at,
         checked_at = excluded.checked_at,
         prospect_count = excluded.prospect_count,
         row_count = excluded.row_count`,
    ).bind(
      input.sourceHash,
      input.algorithmVersion,
      input.now,
      input.now,
      input.identities.length,
      input.records.length,
    ),
  ];

  const results = await env.DB.batch(statements);
  if (results.some(result => !result.success)) {
    throw new Error("D1 rejected the scouting snapshot bulk promotion.");
  }
}
