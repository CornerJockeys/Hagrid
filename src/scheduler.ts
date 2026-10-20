export const MASTER_CRON = "*/10 * * * *";

export function isHourlyRefreshTime(timestamp: number): boolean {
  return new Date(timestamp).getUTCMinutes() === 20;
}

export function isRulebookWatchTime(timestamp: number): boolean {
  return new Date(timestamp).getUTCMinutes() === 20;
}
