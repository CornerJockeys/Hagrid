import {getCachedGuildConfig} from "../config-cache";
import {getCurrentLeagueSnapshot, snapshotTeamPlayers, snapshotTeamScrimStats} from "../league/cache";
import {isCompetitiveSlot, slotLabel, teamDivision, type TeamDivision} from "../league/view";
import {getPlayerProfileMetadata} from "../player-meta";
import type {Env} from "../types";
import {getActivityAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

type DivisionFilter = "all" | TeamDivision;

function parseDivision(request: Request): DivisionFilter | Response {
  const raw = new URL(request.url).searchParams.get("division")?.trim().toLocaleUpperCase("en-US") ?? "ALL";
  if (raw === "ALL") return "all";
  if (raw === "FL" || raw === "AL" || raw === "CL" || raw === "ML") return raw;
  return Response.json({error: "division must be all, FL, AL, CL, or ML."}, {status: 400});
}

export async function getActivityStats(request: Request, env: Env): Promise<Response> {
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

  const division = parseDivision(request);
  if (division instanceof Response) return division;

  const snapshot = await getCurrentLeagueSnapshot(env);
  if (!snapshot) {
    return Response.json({error: "Hagrid does not have a current league snapshot yet."}, {status: 503});
  }

  const players = snapshotTeamPlayers(snapshot, config.franchise_name)
    .filter(player => isCompetitiveSlot(player.slot))
    .map(player => ({player, division: teamDivision(player.skill_group)}))
    .filter((value): value is {player: typeof snapshot.players[number]; division: TeamDivision} => value.division !== null)
    .filter(value => division === "all" || value.division === division);

  const metadata = await getPlayerProfileMetadata(
    env.DB,
    players.map(value => value.player.sprocket_player_id),
  );
  const stats = snapshotTeamScrimStats(snapshot, config.franchise_name);
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
    franchise: config.franchise_name,
    division,
    source_as_of: snapshot.state.source_as_of,
    refreshed_at: snapshot.state.refreshed_at,
    rows,
  });
}
