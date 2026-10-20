import {MASTER_CRON} from "../scheduler";
import type {Env, ScheduledEventLike} from "../types";
import {SEASON_20_RULEBOOK} from "./data.ts";

export const RULEBOOK_WATCH_CRON = MASTER_CRON;
export const RULEBOOK_DOCUMENT_ID = "12HhCEkuGfGF9Q5pjhPPea4okGUF9eguwgFL9D7mRk24";
export const RULEBOOK_SOURCE_URL =
  `https://docs.google.com/document/d/${RULEBOOK_DOCUMENT_ID}/edit`;
export const RULEBOOK_TEXT_EXPORT_URL =
  `https://docs.google.com/document/d/${RULEBOOK_DOCUMENT_ID}/export?format=txt`;
export const RULEBOOK_PDF_EXPORT_URL =
  `https://docs.google.com/document/d/${RULEBOOK_DOCUMENT_ID}/export?format=pdf`;

const RULEBOOK_CACHE_KEY = "rulebook:league:current:v1";
const RULEBOOK_CHANGE_CHANNEL_ID = "1555065645937201277";
const RULEBOOK_CHANGE_USER_ID = "443544081696686080";
const MIN_RULEBOOK_LENGTH = 10_000;
const MIN_PREVIOUS_LENGTH_RATIO = 0.6;

export interface RulebookWatchState {
  enabled: boolean;
  sourceUrl: string;
  currentHash: string | null;
  currentLength: number | null;
  currentContent: string | null;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  pausedAt: string | null;
  pausedByDiscordId: string | null;
  resumedAt: string | null;
  resumedByDiscordId: string | null;
}

export interface RulebookSnapshot {
  content: string;
  sourceHash: string | null;
  lastSyncedAt: string | null;
  watchEnabled: boolean;
  sourceUrl: string;
}

interface WatchStateRow {
  enabled: number;
  source_url: string;
  current_hash: string | null;
  current_length: number | null;
  current_content: string | null;
  last_checked_at: string | null;
  last_synced_at: string | null;
  paused_at: string | null;
  paused_by_discord_id: string | null;
  resumed_at: string | null;
  resumed_by_discord_id: string | null;
}

export interface RulebookDiffHunk {
  context: string[];
  before: string[];
  after: string[];
}

function cleanSourceText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function canonicalNumber(value: string): string {
  if (!/^\d+\.\d+$/.test(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

export function canonicalRulebookLine(value: string): string {
  return value
    .trim()
    .replace(/[\t ]+/g, " ")
    .replace(/\b\d+\.\d+\b/g, canonicalNumber);
}

export function canonicalRulebookText(value: string): string {
  return cleanSourceText(value)
    .split("\n")
    .map(canonicalRulebookLine)
    .filter(Boolean)
    .join("\n");
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function rulebookContentHash(value: string): Promise<string> {
  return sha256(canonicalRulebookText(value));
}

function comparableLines(value: string): Array<{display: string; key: string}> {
  return cleanSourceText(value)
    .split("\n")
    .map(display => ({display: display.trim(), key: canonicalRulebookLine(display)}))
    .filter(line => Boolean(line.key));
}

function findAnchor(
  before: Array<{display: string; key: string}>,
  after: Array<{display: string; key: string}>,
  beforeIndex: number,
  afterIndex: number,
  lookahead = 30,
): {beforeOffset: number; afterOffset: number} | null {
  let best: {beforeOffset: number; afterOffset: number; cost: number} | null = null;
  const beforeMax = Math.min(before.length, beforeIndex + lookahead + 1);
  const afterMax = Math.min(after.length, afterIndex + lookahead + 1);

  for (let i = beforeIndex; i < beforeMax; i += 1) {
    for (let j = afterIndex; j < afterMax; j += 1) {
      if (before[i].key !== after[j].key) continue;
      const beforeOffset = i - beforeIndex;
      const afterOffset = j - afterIndex;
      if (beforeOffset === 0 && afterOffset === 0) {
        return {beforeOffset, afterOffset};
      }
      const cost = beforeOffset + afterOffset;
      if (!best || cost < best.cost) best = {beforeOffset, afterOffset, cost};
    }
  }
  return best ? {beforeOffset: best.beforeOffset, afterOffset: best.afterOffset} : null;
}

function diffContext(
  lines: Array<{display: string; key: string}>,
  index: number,
): string[] {
  return lines
    .slice(Math.max(0, index - 3), index)
    .map(line => line.display)
    .filter(Boolean);
}

export function diffRulebookContent(
  previous: string,
  next: string,
): RulebookDiffHunk[] {
  const before = comparableLines(previous);
  const after = comparableLines(next);
  const hunks: RulebookDiffHunk[] = [];
  let i = 0;
  let j = 0;

  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i].key === after[j].key) {
      i += 1;
      j += 1;
      continue;
    }

    const context = diffContext(before, i);

    if (i >= before.length) {
      hunks.push({
        context,
        before: [],
        after: after.slice(j).map(line => line.display),
      });
      break;
    }
    if (j >= after.length) {
      hunks.push({
        context,
        before: before.slice(i).map(line => line.display),
        after: [],
      });
      break;
    }

    const anchor = findAnchor(before, after, i, j);
    if (!anchor || (anchor.beforeOffset === 0 && anchor.afterOffset === 0)) {
      const oldLine = before[i]?.display ? [before[i].display] : [];
      const newLine = after[j]?.display ? [after[j].display] : [];
      hunks.push({context, before: oldLine, after: newLine});
      i += oldLine.length;
      j += newLine.length;
      continue;
    }

    hunks.push({
      context,
      before: before.slice(i, i + anchor.beforeOffset).map(line => line.display),
      after: after.slice(j, j + anchor.afterOffset).map(line => line.display),
    });
    i += anchor.beforeOffset;
    j += anchor.afterOffset;
  }

  return hunks.filter(hunk => hunk.before.length > 0 || hunk.after.length > 0);
}

function quote(lines: string[]): string {
  if (lines.length === 0) return "> *(none)*";
  return lines.map(line => `> ${line || " "}`).join("\n");
}

function diffText(hunks: RulebookDiffHunk[]): string {
  return hunks.map((hunk, index) => [
    `**Change ${index + 1}**`,
    ...(hunk.context.length > 0 ? ["**Context**", quote(hunk.context)] : []),
    "**Before**",
    quote(hunk.before),
    "**After**",
    quote(hunk.after),
  ].join("\n")).join("\n\n");
}

function splitDiscordText(value: string, limit = 1800): string[] {
  const lines = value.split("\n");
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = (): void => {
    if (!current) return;
    chunks.push(current);
    current = "";
  };

  for (const original of lines) {
    let line = original;
    while (line.length > limit) {
      pushCurrent();
      chunks.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      pushCurrent();
      current = line;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks;
}

async function notificationChunkSent(
  env: Env,
  sourceHash: string,
  chunkIndex: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS present
     FROM rulebook_notification_chunks
     WHERE source_hash = ? AND chunk_index = ?`,
  ).bind(sourceHash, chunkIndex).first<{present: number}>();
  return Boolean(row?.present);
}

async function markNotificationChunkSent(
  env: Env,
  sourceHash: string,
  chunkIndex: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO rulebook_notification_chunks (source_hash, chunk_index)
     VALUES (?, ?)`,
  ).bind(sourceHash, chunkIndex).run();
}

async function postRulebookChange(
  env: Env,
  sourceHash: string,
  hunks: RulebookDiffHunk[],
  syncedAt: string,
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not configured.");
  }

  const body = diffText(hunks);
  const chunks = splitDiscordText(body, 1500);
  const header = [
    "📘 **RULEBOOK CHANGE**",
    `<@${RULEBOOK_CHANGE_USER_ID}>`,
    "",
    `The official MLE Season 20 Rulebook changed. Detected ${hunks.length} changed block${hunks.length === 1 ? "" : "s"}.`,
    `Accepted by Hagrid: **${syncedAt}**`,
  ].join("\n");

  const messages = chunks.length > 0
    ? [`${header}\n\n${chunks[0]}`, ...chunks.slice(1)]
    : [header];

  for (let index = 0; index < messages.length; index += 1) {
    if (await notificationChunkSent(env, sourceHash, index)) continue;
    const response = await fetch(
      `https://discord.com/api/v10/channels/${RULEBOOK_CHANGE_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: messages[index],
          allowed_mentions: index === 0
            ? {parse: [], users: [RULEBOOK_CHANGE_USER_ID]}
            : {parse: []},
        }),
      },
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Rulebook change notification failed (${response.status}): ${error.slice(0, 500)}`,
      );
    }
    await markNotificationChunkSent(env, sourceHash, index);
  }
}

export async function getRulebookWatchState(env: Env): Promise<RulebookWatchState> {
  const row = await env.DB.prepare(
    `SELECT enabled, source_url, current_hash, current_length, current_content, last_checked_at,
            last_synced_at, paused_at, paused_by_discord_id, resumed_at,
            resumed_by_discord_id
     FROM rulebook_watch_state
     WHERE id = 1`,
  ).first<WatchStateRow>();

  return {
    enabled: row ? row.enabled === 1 : true,
    sourceUrl: row?.source_url ?? RULEBOOK_SOURCE_URL,
    currentHash: row?.current_hash ?? null,
    currentLength: row?.current_length ?? null,
    currentContent: row?.current_content ?? null,
    lastCheckedAt: row?.last_checked_at ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
    pausedAt: row?.paused_at ?? null,
    pausedByDiscordId: row?.paused_by_discord_id ?? null,
    resumedAt: row?.resumed_at ?? null,
    resumedByDiscordId: row?.resumed_by_discord_id ?? null,
  };
}

export async function setRulebookWatchEnabled(
  env: Env,
  enabled: boolean,
  actorDiscordId: string,
): Promise<void> {
  if (enabled) {
    await env.DB.prepare(
      `UPDATE rulebook_watch_state
       SET enabled = 1,
           resumed_at = CURRENT_TIMESTAMP,
           resumed_by_discord_id = ?,
           paused_at = NULL,
           paused_by_discord_id = NULL
       WHERE id = 1`,
    ).bind(actorDiscordId).run();
    return;
  }

  await env.DB.prepare(
    `UPDATE rulebook_watch_state
     SET enabled = 0,
         paused_at = CURRENT_TIMESTAMP,
         paused_by_discord_id = ?
     WHERE id = 1`,
  ).bind(actorDiscordId).run();
}

async function cachedRulebook(env: Env): Promise<string | null> {
  if (!env.HAGRID_CACHE) return null;
  try {
    return await env.HAGRID_CACHE.get(RULEBOOK_CACHE_KEY, "text");
  } catch (error) {
    console.error("Could not read live rulebook from KV.", error);
    return null;
  }
}

async function storeRulebook(env: Env, content: string): Promise<void> {
  if (!env.HAGRID_CACHE) return;
  await env.HAGRID_CACHE.put(RULEBOOK_CACHE_KEY, content);
}

export async function getCurrentRulebookSnapshot(env: Env): Promise<RulebookSnapshot> {
  const [state, cached] = await Promise.all([
    getRulebookWatchState(env),
    cachedRulebook(env),
  ]);
  return {
    content: cached ?? state.currentContent ?? SEASON_20_RULEBOOK,
    sourceHash: state.currentHash,
    lastSyncedAt: state.lastSyncedAt,
    watchEnabled: state.enabled,
    sourceUrl: state.sourceUrl,
  };
}

async function fetchPublicRulebook(): Promise<string> {
  const response = await fetch(RULEBOOK_TEXT_EXPORT_URL, {
    headers: {"User-Agent": "Hagrid Rulebook Watcher"},
  });
  if (!response.ok) {
    throw new Error(`Google Docs rulebook export failed (${response.status}).`);
  }
  return cleanSourceText(await response.text());
}

function saneRulebook(content: string, previousLength: number | null): boolean {
  if (content.length < MIN_RULEBOOK_LENGTH) return false;
  if (previousLength && content.length < Math.floor(previousLength * MIN_PREVIOUS_LENGTH_RATIO)) {
    return false;
  }
  return true;
}

async function recordRevision(
  env: Env,
  hash: string,
  contentLength: number,
  hunks: RulebookDiffHunk[],
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO rulebook_revisions (
       source_hash, content_length, change_count, diff_json
     ) VALUES (?, ?, ?, ?)`,
  ).bind(hash, contentLength, hunks.length, JSON.stringify(hunks)).run();
}

export async function checkRulebookForChanges(env: Env): Promise<{
  checked: boolean;
  changed: boolean;
  initialized: boolean;
  ignoredAsUnsafe: boolean;
  changeCount: number;
}> {
  const state = await getRulebookWatchState(env);
  if (!state.enabled) {
    return {checked: false, changed: false, initialized: false, ignoredAsUnsafe: false, changeCount: 0};
  }

  const checkedAt = new Date().toISOString();
  let next: string;
  try {
    next = await fetchPublicRulebook();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE rulebook_watch_state SET last_checked_at = CURRENT_TIMESTAMP WHERE id = 1",
    ).run();
    throw error;
  }

  if (!saneRulebook(next, state.currentLength)) {
    console.warn(
      `Rulebook watcher ignored an unsafe-looking source snapshot (length ${next.length}; previous ${state.currentLength ?? "unknown"}).`,
    );
    await env.DB.prepare(
      "UPDATE rulebook_watch_state SET last_checked_at = CURRENT_TIMESTAMP WHERE id = 1",
    ).run();
    return {checked: true, changed: false, initialized: false, ignoredAsUnsafe: true, changeCount: 0};
  }

  const nextHash = await rulebookContentHash(next);
  const cached = await cachedRulebook(env);
  if (state.currentHash === nextHash) {
    if (!cached) await storeRulebook(env, state.currentContent ?? next);
    await env.DB.prepare(
      "UPDATE rulebook_watch_state SET last_checked_at = CURRENT_TIMESTAMP WHERE id = 1",
    ).run();
    return {checked: true, changed: false, initialized: false, ignoredAsUnsafe: false, changeCount: 0};
  }

  const previous = cached ?? state.currentContent ?? SEASON_20_RULEBOOK;

  // First deployment establishes the public document as the known-good baseline
  // without manufacturing a change notification from an older bundled fallback.
  if (!state.currentHash) {
    await storeRulebook(env, next);
    await recordRevision(env, nextHash, next.length, []);
    await env.DB.prepare(
      `UPDATE rulebook_watch_state
       SET current_hash = ?, current_length = ?, current_content = ?,
           last_checked_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
    ).bind(nextHash, next.length, next).run();
    return {checked: true, changed: false, initialized: true, ignoredAsUnsafe: false, changeCount: 0};
  }

  const hunks = diffRulebookContent(previous, next);
  if (hunks.length === 0) {
    // Canonical comparison can intentionally ignore formatting-only edits.
    await storeRulebook(env, next);
    await env.DB.prepare(
      `UPDATE rulebook_watch_state
       SET current_hash = ?, current_length = ?, current_content = ?,
           last_checked_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
    ).bind(nextHash, next.length, next).run();
    return {checked: true, changed: false, initialized: false, ignoredAsUnsafe: false, changeCount: 0};
  }

  await postRulebookChange(env, nextHash, hunks, checkedAt);
  await storeRulebook(env, next);
  await recordRevision(env, nextHash, next.length, hunks);
  await env.DB.prepare(
    `UPDATE rulebook_watch_state
     SET current_hash = ?, current_length = ?, current_content = ?,
         last_checked_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
  ).bind(nextHash, next.length, next).run();

  return {
    checked: true,
    changed: true,
    initialized: false,
    ignoredAsUnsafe: false,
    changeCount: hunks.length,
  };
}

export async function runScheduledRulebookWatch(
  env: Env,
  event: ScheduledEventLike,
): Promise<void> {
  if (event.cron !== RULEBOOK_WATCH_CRON) return;
  try {
    await checkRulebookForChanges(env);
  } catch (error) {
    console.error("Scheduled rulebook watcher failed.", error);
  }
}

export async function rulebookWatchPublicStatus(env: Env): Promise<Response> {
  const state = await getRulebookWatchState(env);
  return Response.json({
    enabled: state.enabled,
    current_hash: state.currentHash,
    last_synced_at: state.lastSyncedAt,
    source_url: state.sourceUrl,
  });
}
