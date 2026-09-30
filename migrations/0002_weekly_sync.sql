CREATE TABLE IF NOT EXISTS sync_runs (
  run_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  franchise_name TEXT NOT NULL,
  franchise_code TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error_message TEXT,
  player_count INTEGER,
  usage_count INTEGER,
  change_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_guild_started
  ON sync_runs (guild_id, started_at DESC);

CREATE TABLE IF NOT EXISTS franchise_players_current (
  guild_id TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  member_id TEXT,
  discord_id TEXT,
  name TEXT NOT NULL,
  salary REAL,
  skill_group TEXT,
  game_id TEXT,
  game_title TEXT,
  franchise_name TEXT NOT NULL,
  staff_position TEXT,
  slot TEXT,
  current_scrim_points INTEGER NOT NULL DEFAULT 0,
  eligible_through TEXT,
  source_as_of TEXT,
  last_sync_run_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, sprocket_player_id)
);

CREATE INDEX IF NOT EXISTS idx_franchise_players_current_slot
  ON franchise_players_current (guild_id, slot);

CREATE TABLE IF NOT EXISTS roster_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  slot TEXT,
  started_run_id TEXT NOT NULL,
  ended_run_id TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_assignments_active
  ON roster_assignments (guild_id, sprocket_player_id)
  WHERE ended_run_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_roster_assignments_history
  ON roster_assignments (guild_id, sprocket_player_id, started_at DESC);

CREATE TABLE IF NOT EXISTS player_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  change_type TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_player_changes_guild_run
  ON player_changes (guild_id, run_id, id);

CREATE TABLE IF NOT EXISTS role_usage_current (
  guild_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  league TEXT NOT NULL,
  role TEXT NOT NULL,
  doubles_uses INTEGER NOT NULL,
  standard_uses INTEGER NOT NULL,
  total_uses INTEGER NOT NULL,
  source_as_of TEXT,
  last_sync_run_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, season_number, league, role)
);

CREATE INDEX IF NOT EXISTS idx_role_usage_current_guild
  ON role_usage_current (guild_id, season_number, league, role);
