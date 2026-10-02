CREATE TABLE IF NOT EXISTS simulated_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_simulated_writes_guild_created
  ON simulated_writes (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulated_writes_command
  ON simulated_writes (command_name, operation_name, created_at DESC);
