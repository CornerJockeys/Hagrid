CREATE TABLE IF NOT EXISTS roster_role_state (
  guild_id TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  division_role_id TEXT,
  captain_managed INTEGER NOT NULL DEFAULT 0 CHECK (captain_managed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, sprocket_player_id)
);

CREATE INDEX IF NOT EXISTS idx_roster_role_state_discord
  ON roster_role_state (guild_id, discord_user_id);
