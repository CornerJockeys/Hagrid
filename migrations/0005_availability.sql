CREATE TABLE availability_submissions (
  guild_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  slots_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, week_start, discord_user_id)
);

CREATE INDEX idx_availability_week
  ON availability_submissions (guild_id, week_start);

CREATE INDEX idx_availability_user
  ON availability_submissions (guild_id, discord_user_id, week_start);
