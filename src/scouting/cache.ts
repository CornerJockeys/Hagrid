import type {ProspectIdentity, ScoutingRecord} from "./calculate";
import type {Env} from "../types";

const SNAPSHOT_KEY = "scouting:current:v1";

export interface CachedScoutingState {
  sourceHash: string;
  algorithmVersion: string;
  refreshedAt: string;
  checkedAt: string;
  prospectCount: number;
  rowCount: number;
}

export interface CachedScoutingSnapshot {
  state: CachedScoutingState;
  identities: ProspectIdentity[];
  records: ScoutingRecord[];
}

export async function getCachedScoutingSnapshot(
  env: Env,
): Promise<CachedScoutingSnapshot | null> {
  if (!env.HAGRID_CACHE) return null;

  try {
    const raw = await env.HAGRID_CACHE.get(SNAPSHOT_KEY, "text");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedScoutingSnapshot;
    if (
      !parsed ||
      !parsed.state ||
      !Array.isArray(parsed.identities) ||
      !Array.isArray(parsed.records)
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to read scouting snapshot from KV.", error);
    return null;
  }
}

export async function putCachedScoutingSnapshot(
  env: Env,
  snapshot: CachedScoutingSnapshot,
): Promise<void> {
  if (!env.HAGRID_CACHE) return;

  await env.HAGRID_CACHE.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
}
