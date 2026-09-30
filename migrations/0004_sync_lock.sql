CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_runs_single_running
  ON sync_runs (guild_id)
  WHERE status = 'RUNNING';
