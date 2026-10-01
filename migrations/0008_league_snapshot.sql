CREATE TABLE IF NOT EXISTS league_snapshot_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  source_hash TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  source_as_of TEXT,
  team_count INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  scrim_stat_count INTEGER NOT NULL,
  usage_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS league_teams_current (
  franchise_name TEXT PRIMARY KEY,
  franchise_code TEXT,
  conference TEXT,
  super_division TEXT,
  division TEXT,
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_league_teams_code
  ON league_teams_current (franchise_code);

CREATE TABLE IF NOT EXISTS league_players_current (
  sprocket_player_id TEXT PRIMARY KEY,
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
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_league_players_team
  ON league_players_current (franchise_name, skill_group, slot);

CREATE INDEX IF NOT EXISTS idx_league_players_name
  ON league_players_current (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS league_player_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  source_hash TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_league_player_history_active
  ON league_player_history (sprocket_player_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_league_player_history_lookup
  ON league_player_history (sprocket_player_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS league_role_usage_current (
  team_name TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  league TEXT NOT NULL,
  role TEXT NOT NULL,
  doubles_uses INTEGER NOT NULL,
  standard_uses INTEGER NOT NULL,
  total_uses INTEGER NOT NULL,
  source_as_of TEXT,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (team_name, season_number, league, role)
);

CREATE INDEX IF NOT EXISTS idx_league_usage_team
  ON league_role_usage_current (team_name, season_number, league, role);

CREATE TABLE IF NOT EXISTS league_scrim_stats_current (
  sprocket_player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  league TEXT,
  games INTEGER NOT NULL,
  win_pct REAL,
  score REAL,
  sprocket REAL,
  dpi REAL,
  opi REAL,
  goals REAL,
  assists REAL,
  saves REAL,
  shots REAL,
  demos REAL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (sprocket_player_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_league_scrim_stats_player
  ON league_scrim_stats_current (sprocket_player_id, mode);
