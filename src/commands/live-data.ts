import type {LeaguePlayerRow, LeagueScrimStatRow, LeagueUsageRow} from "../league/db";
import type {RawScoutingLine, ProspectIdentity} from "../scouting/calculate";
import type {FranchisePlayer} from "../sprocket/players";
import type {RoleUsage} from "../sprocket/role-usages";

export function leaguePlayerFromFranchise(player: FranchisePlayer): LeaguePlayerRow {
  return {
    sprocket_player_id: player.sprocketPlayerId,
    member_id: player.memberId,
    discord_id: player.discordId,
    name: player.name,
    salary: player.salary,
    skill_group: player.skillGroup,
    game_id: player.gameId,
    game_title: player.gameTitle,
    franchise_name: player.franchise,
    staff_position: player.staffPosition,
    slot: player.slot,
    current_scrim_points: player.currentScrimPoints,
    eligible_through: player.eligibleThrough,
    source_as_of: player.sourceAsOf,
    refreshed_at: "",
  };
}

export function leaguePlayerFromProspect(player: ProspectIdentity): LeaguePlayerRow {
  return {
    sprocket_player_id: player.sprocketPlayerId,
    member_id: null,
    discord_id: null,
    name: player.name,
    salary: player.salary,
    skill_group: player.league,
    game_id: null,
    game_title: "Rocket League",
    franchise_name: player.status,
    staff_position: null,
    slot: null,
    current_scrim_points: 0,
    eligible_through: null,
    source_as_of: null,
    refreshed_at: "",
  };
}

export function leagueUsageFromSource(usage: RoleUsage): LeagueUsageRow {
  return {
    team_name: usage.teamName,
    season_number: usage.seasonNumber,
    league: usage.league,
    role: usage.role,
    doubles_uses: usage.doublesUses,
    standard_uses: usage.standardUses,
    total_uses: usage.totalUses,
    source_as_of: usage.sourceAsOf,
    refreshed_at: "",
  };
}

export function leagueScrimFromSource(stat: RawScoutingLine): LeagueScrimStatRow {
  return {
    sprocket_player_id: stat.sprocketPlayerId,
    mode: stat.mode,
    league: stat.league,
    games: stat.games,
    win_pct: stat.winPct,
    score: stat.score,
    sprocket: stat.sprocket,
    dpi: stat.dpi,
    opi: stat.opi,
    goals: stat.goals,
    assists: stat.assists,
    saves: stat.saves,
    shots: stat.shots,
    demos: stat.demos,
    refreshed_at: "",
  };
}

export function latestSourceTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: {raw: string; time: number} | null = null;
  for (const raw of values) {
    if (!raw) continue;
    const time = Date.parse(raw);
    if (!Number.isFinite(time)) continue;
    if (!latest || time > latest.time) latest = {raw, time};
  }
  return latest?.raw ?? null;
}

export function safeCommandError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}
