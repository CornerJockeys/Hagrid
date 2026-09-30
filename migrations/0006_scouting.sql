CREATE TABLE IF NOT EXISTS scouting_refresh_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  source_hash TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  prospect_count INTEGER NOT NULL,
  row_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scouting_players_current (
  sprocket_player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  league TEXT NOT NULL,
  status TEXT NOT NULL,
  name TEXT NOT NULL,
  salary REAL,
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
  shot_pct REAL,
  demos REAL,
  eff_salary REAL,
  temp REAL,
  temp_score REAL,
  bucket TEXT NOT NULL,
  main_role TEXT,
  alt_role TEXT,
  role_confidence TEXT,
  flags TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (sprocket_player_id, mode)
);

CREATE INDEX IF NOT EXISTS scouting_current_league_status_idx
  ON scouting_players_current (league, status, mode);
CREATE INDEX IF NOT EXISTS scouting_current_name_idx
  ON scouting_players_current (name);

CREATE TABLE IF NOT EXISTS scouting_daily_history (
  snapshot_date TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  league TEXT NOT NULL,
  status TEXT NOT NULL,
  name TEXT NOT NULL,
  salary REAL,
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
  shot_pct REAL,
  demos REAL,
  eff_salary REAL,
  temp REAL,
  temp_score REAL,
  bucket TEXT NOT NULL,
  main_role TEXT,
  alt_role TEXT,
  role_confidence TEXT,
  flags TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, sprocket_player_id, mode)
);

CREATE INDEX IF NOT EXISTS scouting_history_player_idx
  ON scouting_daily_history (sprocket_player_id, mode, snapshot_date);
