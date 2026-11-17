import {getCachedGuildConfig} from "../config-cache";
import {getCurrentLeagueSnapshot, snapshotTeamPlayers, snapshotTeamScrimStats} from "../league/cache";
import {isCompetitiveSlot, slotLabel, teamDivision, type TeamDivision} from "../league/view";
import {getPlayerProfileMetadata} from "../player-meta";
import {
  aggregateMatchStatLines,
  aggregatePlayerSeries,
  getFranchiseSeason20MatchData,
  playerMatchGamesForMode,
  type MatchStatLine,
} from "../sprocket/match-stats";
import type {Env} from "../types";
import {getActivityAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

type DivisionFilter = "all" | TeamDivision;
type StatsSource = "matches" | "scrims";

function parseDivision(request: Request): DivisionFilter | Response {
  const raw = new URL(request.url).searchParams.get("division")?.trim().toLocaleUpperCase("en-US") ?? "ALL";
  if (raw === "ALL") return "all";
  if (raw === "FL" || raw === "AL" || raw === "CL" || raw === "ML") return raw;
  return Response.json({error: "division must be all, FL, AL, CL, or ML."}, {status: 400});
}

function parseSource(request: Request): StatsSource | Response {
  const raw = new URL(request.url).searchParams.get("source")?.trim().toLocaleLowerCase("en-US") ?? "matches";
  if (raw === "matches" || raw === "scrims") return raw;
  return Response.json({error: "source must be matches or scrims."}, {status: 400});
}

function latestMatchTimestamp(
  games: Array<{submittedAt: string | null}>,
): string | null {
  let latest: {raw: string; time: number} | null = null;
  for (const game of games) {
    if (!game.submittedAt) continue;
    const time = Date.parse(game.submittedAt);
    if (!Number.isFinite(time)) continue;
    if (!latest || time > latest.time) latest = {raw: game.submittedAt, time};
  }
  return latest?.raw ?? null;
}

function matchStatJson(stat: MatchStatLine) {
  return {
    mode: stat.mode,
    games: stat.games,
    win_pct: stat.winPct,
    score: stat.score,
    sprocket: stat.gpi,
    gpi: stat.gpi,
    dpi: stat.dpi,
    opi: stat.opi,
    goals: stat.goals,
    assists: stat.assists,
    saves: stat.saves,
    shots: stat.shots,
    demos: stat.demos,
  };
}

async function activityStatsContext(request: Request, env: Env) {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;

  const access = await getActivityAccess(env, auth);
  if (!access.rosterMember && !access.staff) {
    return Response.json({error: "Roster access is required for team stats."}, {status: 403});
  }

  const config = await getCachedGuildConfig(env, auth.guildId);
  if (!config) {
    return Response.json({error: "No franchise is configured for this Discord server."}, {status: 409});
  }

  const snapshot = await getCurrentLeagueSnapshot(env);
  if (!snapshot) {
    return Response.json({error: "Hagrid does not have a current league snapshot yet."}, {status: 503});
  }

  return {auth, access, config, snapshot};
}

export async function getActivityStats(request: Request, env: Env): Promise<Response> {
  const context = await activityStatsContext(request, env);
  if (context instanceof Response) return context;

  const division = parseDivision(request);
  if (division instanceof Response) return division;
  const source = parseSource(request);
  if (source instanceof Response) return source;

  const players = snapshotTeamPlayers(context.snapshot, context.config.franchise_name)
    .filter(player => isCompetitiveSlot(player.slot))
    .map(player => ({player, division: teamDivision(player.skill_group)}))
    .filter((value): value is {player: typeof context.snapshot.players[number]; division: TeamDivision} => value.division !== null)
    .filter(value => division === "all" || value.division === division);

  const metadata = await getPlayerProfileMetadata(
    env.DB,
    players.map(value => value.player.sprocket_player_id),
  );

  if (source === "matches") {
    const matchData = await getFranchiseSeason20MatchData(env, context.config.franchise_name);
    const gamesByMember = new Map<string, typeof matchData.games>();

    for (const game of matchData.games) {
      const rows = gamesByMember.get(game.memberId) ?? [];
      rows.push(game);
      gamesByMember.set(game.memberId, rows);
    }

    const rows = players
      .map(({player, division: playerDivision}) => {
        const meta = metadata.get(player.sprocket_player_id) ?? null;
        const games = player.member_id
          ? gamesByMember.get(player.member_id) ?? []
          : [];
        return {
          sprocket_player_id: player.sprocket_player_id,
          name: player.name,
          division: playerDivision,
          slot: slotLabel(player.slot),
          salary: player.salary,
          joined_date: meta?.joinedDate ?? null,
          seasons_played: meta?.seasonsPlayed ?? null,
          seasons: meta?.seasons ?? [],
          stats: aggregateMatchStatLines(games, matchData.matches).map(matchStatJson),
        };
      })
      .sort((a, b) =>
        a.division.localeCompare(b.division) ||
        a.slot.localeCompare(b.slot, "en-US", {numeric: true}) ||
        a.name.localeCompare(b.name),
      );

    return Response.json({
      franchise: context.config.franchise_name,
      division,
      source,
      source_as_of: latestMatchTimestamp(matchData.games),
      refreshed_at: null,
      rows,
    });
  }

  const stats = snapshotTeamScrimStats(context.snapshot, context.config.franchise_name);
  const statsByPlayer = new Map<string, typeof stats>();
  for (const stat of stats) {
    const rows = statsByPlayer.get(stat.sprocket_player_id) ?? [];
    rows.push(stat);
    statsByPlayer.set(stat.sprocket_player_id, rows);
  }

  const rows = players
    .map(({player, division: playerDivision}) => {
      const meta = metadata.get(player.sprocket_player_id) ?? null;
      return {
        sprocket_player_id: player.sprocket_player_id,
        name: player.name,
        division: playerDivision,
        slot: slotLabel(player.slot),
        salary: player.salary,
        joined_date: meta?.joinedDate ?? null,
        seasons_played: meta?.seasonsPlayed ?? null,
        seasons: meta?.seasons ?? [],
        stats: (statsByPlayer.get(player.sprocket_player_id) ?? [])
          .slice()
          .sort((a, b) => a.mode.localeCompare(b.mode))
          .map(stat => ({
            mode: stat.mode,
            games: stat.games,
            win_pct: stat.win_pct,
            score: stat.score,
            sprocket: stat.sprocket,
            gpi: null,
            dpi: stat.dpi,
            opi: stat.opi,
            goals: stat.goals,
            assists: stat.assists,
            saves: stat.saves,
            shots: stat.shots,
            demos: stat.demos,
          })),
      };
    })
    .sort((a, b) =>
      a.division.localeCompare(b.division) ||
      a.slot.localeCompare(b.slot, "en-US", {numeric: true}) ||
      a.name.localeCompare(b.name),
    );

  return Response.json({
    franchise: context.config.franchise_name,
    division,
    source,
    source_as_of: context.snapshot.state.source_as_of,
    refreshed_at: context.snapshot.state.refreshed_at,
    rows,
  });
}

export async function getActivityStatsPlayer(
  request: Request,
  env: Env,
): Promise<Response> {
  const context = await activityStatsContext(request, env);
  if (context instanceof Response) return context;

  const url = new URL(request.url);
  const playerId = url.searchParams.get("player_id")?.trim() ?? "";
  const mode = url.searchParams.get("mode")?.trim().toLocaleLowerCase("en-US") ?? "";
  if (!playerId) {
    return Response.json({error: "player_id is required."}, {status: 400});
  }
  if (mode !== "2s" && mode !== "3s") {
    return Response.json({error: "mode must be 2s or 3s."}, {status: 400});
  }

  const player = snapshotTeamPlayers(context.snapshot, context.config.franchise_name)
    .find(value =>
      value.sprocket_player_id === playerId &&
      isCompetitiveSlot(value.slot),
    );
  if (!player) {
    return Response.json({error: "That player is not on the current franchise roster."}, {status: 404});
  }
  if (!player.member_id) {
    return Response.json({
      player: {
        sprocket_player_id: player.sprocket_player_id,
        name: player.name,
        division: teamDivision(player.skill_group),
        slot: slotLabel(player.slot),
      },
      matches: [],
      source_as_of: null,
    });
  }

  const matchData = await getFranchiseSeason20MatchData(env, context.config.franchise_name);
  const games = playerMatchGamesForMode(matchData.games, player.member_id, mode);

  return Response.json({
    player: {
      sprocket_player_id: player.sprocket_player_id,
      name: player.name,
      division: teamDivision(player.skill_group),
      slot: slotLabel(player.slot),
    },
    matches: aggregatePlayerSeries(games, matchData.matches).map(match => ({
      match_id: match.matchId,
      mode: match.mode,
      opponent: match.opponent,
      scheduled_time: match.scheduledTime,
      result: match.result,
      team_wins: match.teamWins,
      opponent_wins: match.opponentWins,
      games_played: match.gamesPlayed,
      game_wins: match.gameWins,
      game_losses: match.gameLosses,
      win_pct: match.winPct,
      score: match.score,
      gpi: match.gpi,
      opi: match.opi,
      dpi: match.dpi,
      goals: match.goals,
      assists: match.assists,
      saves: match.saves,
      shots: match.shots,
      demos: match.demos,
    })),
    source_as_of: latestMatchTimestamp(games),
  });
}
