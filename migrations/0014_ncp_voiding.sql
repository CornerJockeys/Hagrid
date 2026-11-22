ALTER TABLE ncp_records
  ADD COLUMN voided_by_discord_id TEXT;

ALTER TABLE ncp_records
  ADD COLUMN voided_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ncp_records_active_usage
  ON ncp_records (franchise_name, season_number, status, voided_at);
