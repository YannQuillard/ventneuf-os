import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "../../../lib/auth/config";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE,
  authCookieOptions,
  encodeSession,
} from "../../../lib/auth/session";
import { OAUTH_STATE_COOKIE, PKCE_VERIFIER_COOKIE } from "../login/route";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface UserInfo {
  sub?: string;
  email?: string;
}

function matches(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clearTransientCookies(response: NextResponse): void {
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(PKCE_VERIFIER_COOKIE);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(PKCE_VERIFIER_COOKIE)?.value;

  if (!code || !state || !expectedState || !verifier || !matches(state, expectedState)) {
    return NextResponse.json({ error: "Invalid or expired authentication request." }, { status: 400 });
  }

  const config = getAuthConfig();
  const tokenResponse = await fetch(new URL("/oauth2/token", config.issuerBaseUrl), {
    body: new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  const tokens = (await tokenResponse.json()) as TokenResponse;

  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    const response = NextResponse.json({ error: "Cognito rejected the authorization code." }, { status: 401 });
    clearTransientCookies(response);
    return response;
  }

  const userInfoResponse = await fetch(new URL("/oauth2/userInfo", config.issuerBaseUrl), {
    cache: "no-store",
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = (await userInfoResponse.json()) as UserInfo;

  if (!userInfoResponse.ok || !userInfo.sub || !userInfo.email) {
    const response = NextResponse.json({ error: "Cognito did not return a valid identity." }, { status: 401 });
    clearTransientCookies(response);
    return response;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + config.sessionMaxAgeSeconds;
  const response = NextResponse.redirect(new URL("/", config.redirectUri));
  response.cookies.set(
    SESSION_COOKIE,
    encodeSession({ sub: userInfo.sub, email: userInfo.email, expiresAt }, config.sessionSecret),
    authCookieOptions(config.sessionMaxAgeSeconds),
  );
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, authCookieOptions(tokens.expires_in));
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    tokens.refresh_token,
    authCookieOptions(config.sessionMaxAgeSeconds),
  );
  clearTransientCookies(response);
  return response;
}
