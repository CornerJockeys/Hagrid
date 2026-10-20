CREATE TABLE IF NOT EXISTS rulebook_watch_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source_url TEXT NOT NULL,
  current_hash TEXT,
  current_length INTEGER,
  last_checked_at TEXT,
  last_synced_at TEXT,
  paused_at TEXT,
  paused_by_discord_id TEXT,
  resumed_at TEXT,
  resumed_by_discord_id TEXT
);

INSERT OR IGNORE INTO rulebook_watch_state (id, enabled, source_url)
VALUES (
  1,
  1,
  'https://docs.google.com/document/d/12HhCEkuGfGF9Q5pjhPPea4okGUF9eguwgFL9D7mRk24/edit'
);

CREATE TABLE IF NOT EXISTS rulebook_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_length INTEGER NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 0,
  diff_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_rulebook_revisions_observed
  ON rulebook_revisions (observed_at DESC);
