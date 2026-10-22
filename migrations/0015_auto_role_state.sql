CREATE TABLE IF NOT EXISTS auto_role_state (
  guild_id TEXT PRIMARY KEY,
  last_success_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
