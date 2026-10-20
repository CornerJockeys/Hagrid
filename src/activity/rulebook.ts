import {
  BROADCAST_RULEBOOK,
  BROADCAST_RULEBOOK_TITLE,
  SEASON_20_RULEBOOK_TITLE,
} from "../rulebooks/data";
import {getCurrentRulebookSnapshot} from "../rulebooks/watch";
import type {Env} from "../types";
import {isAccessResponse, requireCaptainPlusAccess} from "./access";
import {authenticateActivityRequest, isAuthResponse} from "./auth";

type RulebookKind = "league" | "broadcast";

function parseKind(request: Request): RulebookKind | Response {
  const raw = new URL(request.url).searchParams.get("kind")?.trim().toLocaleLowerCase("en-US") ?? "league";
  if (raw === "league" || raw === "broadcast") return raw;
  return Response.json({error: "kind must be league or broadcast."}, {status: 400});
}

export async function getActivityRulebook(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateActivityRequest(request, env);
  if (isAuthResponse(auth)) return auth;
  const access = await requireCaptainPlusAccess(env, auth);
  if (isAccessResponse(access)) return access;

  const kind = parseKind(request);
  if (kind instanceof Response) return kind;
  if (kind === "broadcast") {
    return Response.json({
      kind,
      title: BROADCAST_RULEBOOK_TITLE,
      warning: "This broadcast rulebook is labeled Season 19 in the source file. Verify any season-specific rule before relying on it for Season 20.",
      content: BROADCAST_RULEBOOK,
    });
  }

  const live = await getCurrentRulebookSnapshot(env);
  return Response.json({
    kind,
    title: SEASON_20_RULEBOOK_TITLE,
    warning: null,
    content: live.content,
    last_synced_at: live.lastSyncedAt,
    watch_enabled: live.watchEnabled,
    source_url: live.sourceUrl,
  });
}
