import type {Env} from "../types";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface DiscordOAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface ActivityPrincipal {
  guildId: string;
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
}

function jsonError(message: string, status: number): Response {
  return Response.json({error: message}, {status});
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

export async function authenticateActivityRequest(request: Request): Promise<ActivityPrincipal | Response> {
  const accessToken = bearerToken(request);
  const guildId = request.headers.get("x-hagrid-guild-id")?.trim() ?? "";

  if (!accessToken || !guildId || !/^\d{10,25}$/.test(guildId)) {
    return jsonError("Activity authentication is required.", 401);
  }

  const headers = {Authorization: `Bearer ${accessToken}`};
  const [userResponse, memberResponse] = await Promise.all([
    fetch(`${DISCORD_API_BASE}/users/@me`, {headers}),
    fetch(`${DISCORD_API_BASE}/users/@me/guilds/${guildId}/member`, {headers}),
  ]);

  if (!userResponse.ok) {
    console.error("Discord Activity user verification failed", userResponse.status);
    return jsonError("Discord could not verify this Activity session.", 401);
  }

  const user = await userResponse.json() as DiscordOAuthUser;
  if (!user?.id) {
    return jsonError("Discord returned an invalid user record.", 401);
  }

  // Discord's user-scoped guild-member endpoint can intermittently reject a
  // still-valid Activity token after the initial Activity bootstrap. When that
  // happens, verify membership with Hagrid's bot credential instead of forcing
  // the user to re-open the Activity.
  if (!memberResponse.ok) {
    if (!env.DISCORD_BOT_TOKEN) {
      console.error("Discord Activity member verification failed", memberResponse.status);
      return jsonError("Discord could not verify this Activity session for the selected server.", 401);
    }
    const botMemberResponse = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/members/${user.id}`,
      {headers: {Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`}},
    );
    if (!botMemberResponse.ok) {
      console.error(
        "Discord Activity member verification failed",
        memberResponse.status,
        "bot fallback",
        botMemberResponse.status,
      );
      return jsonError("Discord could not verify this Activity session for the selected server.", 401);
    }
  }
  return {
    guildId,
    userId: user.id,
    username: user.username,
    displayName: user.global_name?.trim() || user.username,
    accessToken,
  };
}

export function isAuthResponse(value: ActivityPrincipal | Response): value is Response {
  return value instanceof Response;
}
