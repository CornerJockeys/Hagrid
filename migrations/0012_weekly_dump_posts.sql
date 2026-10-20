CREATE TABLE IF NOT EXISTS weekly_dump_posts (
  guild_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  match_week INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('eligibility', 'salary', 'usage')),
  posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, season_number, report_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_weekly_dump_posts_season
  ON weekly_dump_posts (season_number, report_date, guild_id);
