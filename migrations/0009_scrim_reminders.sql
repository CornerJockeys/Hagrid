CREATE TABLE IF NOT EXISTS scrim_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  franchise_name TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  player_discord_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  division TEXT,
  due_date TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'normal' CHECK (cadence IN ('normal', 'daily', 'once')),
  created_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_ping_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  completed_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrim_reminders_active
  ON scrim_reminders (status, due_date, guild_id);

CREATE INDEX IF NOT EXISTS idx_scrim_reminders_player
  ON scrim_reminders (guild_id, sprocket_player_id, status);
