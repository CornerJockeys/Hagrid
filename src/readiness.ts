import type {Env} from "./types";

const REQUIRED_TABLES = [
  "guild_config",
  "franchise_players_current",
  "availability_submissions",
  "scouting_players_current",
  "prospect_pool_current",
  "scouting_refresh_state",
  "league_snapshot_state",
  "league_teams_current",
  "league_players_current",
  "league_scrim_stats_current",
] as const;

interface TableRow {
  name: string;
}

export interface ReadinessReport {
  ok: boolean;
  database: {
    ok: boolean;
    missing_tables: string[];
  };
  discord: {
    public_key: boolean;
    application_id: boolean;
    client_secret: boolean;
  };
}

function configured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function getReadiness(env: Env): Promise<ReadinessReport> {
  let databaseOk = false;
  let missingTables: string[] = [...REQUIRED_TABLES];

  try {
    const result = await env.DB.prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN (${REQUIRED_TABLES.map(() => "?").join(", ")})`,
    ).bind(...REQUIRED_TABLES).all<TableRow>();

    if (result.success) {
      const present = new Set(result.results.map(row => row.name));
      missingTables = REQUIRED_TABLES.filter(name => !present.has(name));
      databaseOk = missingTables.length === 0;
    }
  } catch (error) {
    console.error("Readiness D1 check failed", error);
  }

  const discord = {
    public_key: configured(env.DISCORD_PUBLIC_KEY),
    application_id: configured(env.DISCORD_APPLICATION_ID),
    client_secret: configured(env.DISCORD_CLIENT_SECRET),
  };

  return {
    ok: databaseOk && Object.values(discord).every(Boolean),
    database: {
      ok: databaseOk,
      missing_tables: missingTables,
    },
    discord,
  };
}

export async function readinessResponse(env: Env): Promise<Response> {
  const report = await getReadiness(env);
  return Response.json(report, {status: report.ok ? 200 : 503});
}
