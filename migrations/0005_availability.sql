CREATE TABLE availability_submissions (
  guild_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, week_start, discord_user_id)
);

CREATE TABLE availability_slots (
  guild_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6),
  minute_of_day INTEGER NOT NULL CHECK (
    minute_of_day >= 720
    AND minute_of_day < 1440
    AND minute_of_day % 30 = 0
  ),
  state INTEGER NOT NULL DEFAULT 1 CHECK (state IN (1, 2)),
  PRIMARY KEY (guild_id, week_start, discord_user_id, day_index, minute_of_day),
  FOREIGN KEY (guild_id, week_start, discord_user_id)
    REFERENCES availability_submissions (guild_id, week_start, discord_user_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_availability_week
  ON availability_slots (guild_id, week_start, day_index, minute_of_day);

CREATE INDEX idx_availability_user
  ON availability_slots (guild_id, discord_user_id, week_start);
