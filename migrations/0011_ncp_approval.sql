ALTER TABLE ncp_records
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE ncp_records
  ADD COLUMN reviewed_by_discord_id TEXT;

ALTER TABLE ncp_records
  ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ncp_records_status
  ON ncp_records (status, season_number, franchise_name, division);
