export const CURRENT_MLE_SEASON = 20;

// Scrim-derived player scouting must not include scrims before this date.
// The current Avg_Scrim_Stats feed is aggregate-only, so consumers must only
// use it once the upstream dataset (or a future dated raw source) can enforce
// this lower bound.
export const SCRIM_STATS_START_DATE = "2026-09-06";
