CREATE TABLE IF NOT EXISTS role_automation_config (
  guild_id TEXT NOT NULL,
  circumstance TEXT NOT NULL,
  role_ids_json TEXT NOT NULL,
  updated_by_discord_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, circumstance)
);

CREATE TABLE IF NOT EXISTS roster_role_assignments (
  guild_id TEXT NOT NULL,
  sprocket_player_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  circumstance TEXT NOT NULL,
  role_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, sprocket_player_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_roster_role_assignments_discord
  ON roster_role_assignments (guild_id, discord_user_id);

INSERT OR IGNORE INTO roster_role_assignments (
  guild_id, sprocket_player_id, discord_user_id, circumstance, role_id
)
SELECT guild_id, sprocket_player_id, discord_user_id, 'legacy_division', division_role_id
FROM roster_role_state
WHERE division_role_id IS NOT NULL;

INSERT OR IGNORE INTO roster_role_assignments (
  guild_id, sprocket_player_id, discord_user_id, circumstance, role_id
)
SELECT guild_id, sprocket_player_id, discord_user_id, 'captain', '727696641502478338'
FROM roster_role_state
WHERE captain_managed = 1;
