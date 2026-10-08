import {getGuildConfig} from "../db";
import {getLeagueTeamPlayers} from "../league/db";
import {isCompetitiveSlot} from "../league/view";
import {getFranchisePlayers, type FranchisePlayer} from "../sprocket/players";
import type {Env} from "../types";

function fromCachedPlayer(player: Awaited<ReturnType<typeof getLeagueTeamPlayers>>[number]): FranchisePlayer {
  return {
    sprocketPlayerId: player.sprocket_player_id,
    memberId: player.member_id,
    discordId: player.discord_id,
    name: player.name,
    salary: player.salary,
    skillGroup: player.skill_group,
    gameId: player.game_id,
    gameTitle: player.game_title,
    franchise: player.franchise_name,
    staffPosition: player.staff_position,
    slot: player.slot,
    currentScrimPoints: player.current_scrim_points,
    eligibleThrough: player.eligible_through,
    sourceAsOf: player.source_as_of,
  };
}

export async function getCurrentCompetitiveFranchiseRoster(
  env: Env,
  guildId: string,
): Promise<FranchisePlayer[]> {
  const config = await getGuildConfig(env.DB, guildId);
  if (!config) return [];

  try {
    return (await getFranchisePlayers(env, config.franchise_name))
      .filter(player => isCompetitiveSlot(player.slot));
  } catch (error) {
    console.error("Live franchise roster lookup failed; using Hagrid snapshot.", error);
    return (await getLeagueTeamPlayers(env.DB, config.franchise_name))
      .map(fromCachedPlayer)
      .filter(player => isCompetitiveSlot(player.slot));
  }
}
