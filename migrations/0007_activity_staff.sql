CREATE INDEX IF NOT EXISTS idx_franchise_players_current_discord
  ON franchise_players_current (guild_id, discord_id);
