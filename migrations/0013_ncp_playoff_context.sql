ALTER TABLE ncp_records
  ADD COLUMN ncp_game_count INTEGER NOT NULL DEFAULT 5
  CHECK (ncp_game_count IN (1, 5));

ALTER TABLE ncp_records
  ADD COLUMN franchise_fault TEXT NOT NULL DEFAULT 'unknown'
  CHECK (franchise_fault IN ('at_fault', 'not_at_fault', 'unknown'));
