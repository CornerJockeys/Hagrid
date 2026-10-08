export interface PlayerTenure {
  joined_date?: string | null;
  seasons_played?: number | null;
  seasons?: string[];
}

function yearsSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const joined = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(joined.getTime())) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - joined.getUTCFullYear();
  const anniversaryPassed =
    now.getUTCMonth() > joined.getUTCMonth() ||
    (now.getUTCMonth() === joined.getUTCMonth() && now.getUTCDate() >= joined.getUTCDate());
  if (!anniversaryPassed) years -= 1;
  return Math.max(0, years);
}

export function playerBadges(player: PlayerTenure): string {
  const years = yearsSince(player.joined_date);
  const seasons = player.seasons_played;
  const values: string[] = [];
  if (years !== null) {
    values.push(`<span class="player-badge" title="MLE tenure from the joined date in the players dataset">${years}y MLE</span>`);
  }
  if (typeof seasons === "number" && Number.isFinite(seasons)) {
    const detail = player.seasons?.length ? `: ${player.seasons.join(", ")}` : "";
    values.push(`<span class="player-badge" title="Seasons with recorded MLE match stats${detail}">${seasons} season${seasons === 1 ? "" : "s"}</span>`);
  }
  return values.length > 0 ? `<span class="player-badges">${values.join("")}</span>` : "";
}
