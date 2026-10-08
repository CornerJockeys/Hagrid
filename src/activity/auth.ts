import type {Env} from "../types";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface DiscordOAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
}

interface DiscordGuildMember {
  roles?: string[];
}

export interface ActivityPrincipal {
  guildId: string;
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
  roleIds: string[];
}

function jsonError(message: string, status: number): Response {
  return Response.json({error: message}, {status});
}
interface PrincipalCacheEntry {
  principal: ActivityPrincipal;
  expiresAt: number;
  staleUntil: number;
}

const PRINCIPAL_CACHE_TTL_MS = 60_000;
const PRINCIPAL_CACHE_STALE_MS = 10 * 60_000;
const principalCache = new Map<string, PrincipalCacheEntry>();

function principalCacheKey(guildId: string, accessToken: string): string {
  return `${guildId}:${accessToken}`;
}

function cachedPrincipal(
  key: string,
  allowStale = false,
): ActivityPrincipal | null {
  const entry = principalCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt > now || (allowStale && entry.staleUntil > now)) {
    return entry.principal;
  }
  principalCache.delete(key);
  return null;
}

function savePrincipal(key: string, principal: ActivityPrincipal): void {
  const now = Date.now();
  principalCache.set(key, {
    principal,
    expiresAt: now + PRINCIPAL_CACHE_TTL_MS,
    staleUntil: now + PRINCIPAL_CACHE_STALE_MS,
  });
  if (principalCache.size > 200) {
    const oldest = principalCache.keys().next().value as string | undefined;
    if (oldest) principalCache.delete(oldest);
  }
}


export async function exchangeActivityCode(request: Request, env: Env): Promise<Response> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_CLIENT_SECRET) {
    return jsonError("Activity OAuth is not configured on this deployment.", 503);
  }

  let body: {code?: unknown};
  try {
    body = await request.json() as {code?: unknown};
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (typeof body.code !== "string" || body.code.length < 1 || body.code.length > 2048) {
    return jsonError("A Discord authorization code is required.", 400);
  }

  const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      client_id: env.DISCORD_APPLICATION_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: body.code,
    }),
  });

  const payload = await tokenResponse.json() as Record<string, unknown>;
  const accessToken = payload.access_token;
  if (!tokenResponse.ok || typeof accessToken !== "string") {
    console.error("Discord Activity token exchange failed", tokenResponse.status);
    return jsonError("Discord authorization failed.", 401);
  }

  return Response.json({access_token: accessToken});
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function authenticateActivityRequest(request: Request, env: Env): Promise<ActivityPrincipal | Response> {
  const accessToken = bearerToken(request);
  const guildId = request.headers.get("x-hagrid-guild-id")?.trim() ?? "";

  if (!accessToken || !guildId || !/^\d{10,25}$/.test(guildId)) {
    return jsonError("Activity authentication is required.", 401);
  }

  const cacheKey = principalCacheKey(guildId, accessToken);
  const fresh = cachedPrincipal(cacheKey);
  if (fresh) return fresh;

  const headers = {Authorization: `Bearer ${accessToken}`};
  let userResponse: Response;
  let memberResponse: Response;
  try {
    [userResponse, memberResponse] = await Promise.all([
      fetch(`${DISCORD_API_BASE}/users/@me`, {headers}),
      fetch(`${DISCORD_API_BASE}/users/@me/guilds/${guildId}/member`, {headers}),
    ]);
  } catch (error) {
    const stale = cachedPrincipal(cacheKey, true);
    if (stale) {
      console.warn("Discord Activity verification fetch failed; using recent cached principal.", error);
      return stale;
    }
    throw error;
  }

  if (!userResponse.ok) {
    const stale = cachedPrincipal(cacheKey, true);
    if (stale && (userResponse.status === 429 || userResponse.status >= 500)) {
      console.warn("Discord Activity user verification was temporarily unavailable; using recent cached principal.", userResponse.status);
      return stale;
    }
    console.error("Discord Activity user verification failed", userResponse.status);
    return jsonError("Discord could not verify this Activity session.", 401);
  }

  const user = await userResponse.json() as DiscordOAuthUser;
  if (!user?.id) {
    return jsonError("Discord returned an invalid user record.", 401);
  }

  let member: DiscordGuildMember | null = null;

  if (memberResponse.ok) {
    member = await memberResponse.json() as DiscordGuildMember;
  } else {
    // Discord's user-scoped guild-member endpoint can intermittently reject a
    // still-valid Activity token after the initial Activity bootstrap. When that
    // happens, verify membership and roles with Hagrid's bot credential instead
    // of forcing the user to re-open the Activity.
    if (!env.DISCORD_BOT_TOKEN) {
      console.error("Discord Activity member verification failed", memberResponse.status);
      return jsonError("Discord could not verify this Activity session for the selected server.", 401);
    }
    const botMemberResponse = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/members/${user.id}`,
      {headers: {Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`}},
    );
    if (!botMemberResponse.ok) {
      const stale = cachedPrincipal(cacheKey, true);
      if (stale && (
        memberResponse.status === 429 || memberResponse.status >= 500 ||
        botMemberResponse.status === 429 || botMemberResponse.status >= 500
      )) {
        console.warn("Discord Activity member verification was temporarily unavailable; using recent cached principal.");
        return stale;
      }
      console.error(
        "Discord Activity member verification failed",
        memberResponse.status,
        "bot fallback",
        botMemberResponse.status,
      );
      return jsonError("Discord could not verify this Activity session for the selected server.", 401);
    }
    member = await botMemberResponse.json() as DiscordGuildMember;
  }

  const principal: ActivityPrincipal = {
    guildId,
    userId: user.id,
    username: user.username,
    displayName: user.global_name?.trim() || user.username,
    accessToken,
    roleIds: Array.isArray(member?.roles)
      ? member.roles.filter((roleId): roleId is string => typeof roleId === "string")
      : [],
  };
  savePrincipal(cacheKey, principal);
  return principal;
}

export function isAuthResponse(value: ActivityPrincipal | Response): value is Response {
  return value instanceof Response;
}
