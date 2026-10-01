import {fetchCsvDataset} from "./client";
import {field, integerField, numberField, sameText} from "./fields";
import {getFranchises} from "./franchises";
import type {CsvRecord} from "./csv";
import type {Env} from "../types";

export interface FranchisePlayer {
  sprocketPlayerId: string;
  memberId: string | null;
  discordId: string | null;
  name: string;
  salary: number | null;
  skillGroup: string | null;
  gameId: string | null;
  gameTitle: string | null;
  franchise: string;
  staffPosition: string | null;
  slot: string | null;
  currentScrimPoints: number;
  eligibleThrough: string | null;
  sourceAsOf: string | null;
}

function fromRow(row: CsvRecord): FranchisePlayer | null {
  const sprocketPlayerId = field(row, "sprocket_player_id", "Sprocket Player ID");
  const name = field(row, "name", "Name");
  const franchise = field(row, "franchise", "Franchise");

  if (!sprocketPlayerId || !name || !franchise) return null;

  const staffPosition = field(
    row,
    "Franchise Staff Position",
    "franchise_staff_position",
    "staff_position",
  );

  return {
    sprocketPlayerId,
    memberId: field(row, "member_id", "Member ID"),
    discordId: field(row, "discord_id", "Discord ID"),
    name,
    salary: numberField(row, "salary", "Salary"),
    skillGroup: field(row, "skill_group", "Skill Group"),
    gameId: field(row, "game_id", "Game ID"),
    gameTitle: field(row, "game_title", "Game Title"),
    franchise,
    staffPosition: staffPosition && staffPosition.toUpperCase() !== "NA" ? staffPosition : null,
    slot: field(row, "slot", "Slot", "role", "Role"),
    currentScrimPoints: integerField(row, "current_scrim_points", "Current Scrim Points") ?? 0,
    eligibleThrough: field(row, "Eligible Through", "eligible_through"),
    sourceAsOf: field(row, "as_of", "As Of"),
  };
}

function isRocketLeague(player: FranchisePlayer): boolean {
  return player.gameTitle !== null && sameText(player.gameTitle, "Rocket League");
}

function dedupePlayers(players: FranchisePlayer[]): FranchisePlayer[] {
  const byId = new Map<string, FranchisePlayer>();
  for (const player of players) {
    if (!byId.has(player.sprocketPlayerId)) byId.set(player.sprocketPlayerId, player);
  }
  return [...byId.values()];
}

/**
 * Current Rocket League players assigned to one of the franchises published by
 * teams.csv. The upstream players dataset also contains thousands of historical
 * and non-rostered RL identities; those must not become current roster rows.
 */
export async function getRocketLeaguePlayers(env: Env): Promise<FranchisePlayer[]> {
  const [rows, franchises] = await Promise.all([
    fetchCsvDataset(env, "players"),
    getFranchises(env),
  ]);
  const franchiseNames = franchises.map(franchise => franchise.name);

  return dedupePlayers(
    rows
      .map(fromRow)
      .filter((player): player is FranchisePlayer =>
        player !== null &&
        isRocketLeague(player) &&
        franchiseNames.some(franchiseName => sameText(player.franchise, franchiseName)),
      ),
  );
}

export async function getFranchisePlayers(
  env: Env,
  franchiseName: string,
): Promise<FranchisePlayer[]> {
  const players = await getRocketLeaguePlayers(env);
  return players.filter(player => sameText(player.franchise, franchiseName));
}
