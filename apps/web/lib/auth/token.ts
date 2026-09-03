import type { AuthConfig } from "./config";

export interface RefreshedAccessToken {
  accessToken: string;
  expiresIn: number;
}

interface RefreshResponse {
  access_token?: string;
  expires_in?: number;
}

export function accessTokenNeedsRefresh(token: string | undefined, now = Date.now()): boolean {
  if (!token) return true;

  try {
    const [, payload] = token.split(".");
    if (!payload) return true;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp !== "number" || claims.exp * 1000 <= now + 60_000;
  } catch {
    return true;
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  config: AuthConfig,
): Promise<RefreshedAccessToken | null> {
  try {
    const response = await fetch(new URL("/oauth2/token", config.issuerBaseUrl), {
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const tokens = (await response.json()) as RefreshResponse;

    if (!response.ok || !tokens.access_token || !tokens.expires_in) return null;
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
  } catch {
    return null;
  }
}
