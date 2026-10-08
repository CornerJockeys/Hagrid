CREATE TABLE IF NOT EXISTS player_profile_metadata (
  sprocket_player_id TEXT PRIMARY KEY,
  member_id TEXT,
  franchise_name TEXT NOT NULL,
  joined_date TEXT,
  seasons_played INTEGER,
  seasons_json TEXT,
  source_note TEXT NOT NULL DEFAULT 'Sprocket players + historicalAggregatedPlayerStats',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_profile_metadata_franchise
  ON player_profile_metadata (franchise_name, sprocket_player_id);

CREATE TABLE IF NOT EXISTS ncp_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interaction_id TEXT UNIQUE,
  guild_id TEXT NOT NULL,
  franchise_name TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  division TEXT NOT NULL,
  mode TEXT NOT NULL,
  match_id TEXT,
  match_label TEXT,
  players_json TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  created_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ncp_records_team
  ON ncp_records (guild_id, franchise_name, season_number, division, created_at DESC);
