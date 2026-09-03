import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "../../../../lib/auth/config";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE,
  authCookieOptions,
} from "../../../../lib/auth/session";
import { accessTokenNeedsRefresh, refreshAccessToken } from "../../../../lib/auth/token";

function endpoint(): URL {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) throw new Error("CONTROL_PLANE_URL is required.");
  return new URL("/api/conversations/hermes/messages", baseUrl);
}

async function proxy(method: "GET" | "POST", request?: NextRequest) {
  const cookieStore = await cookies();
  let token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>> = null;

  if (accessTokenNeedsRefresh(token)) {
    if (!refreshToken) return unauthorized();
    refreshed = await refreshAccessToken(refreshToken, getAuthConfig());
    if (!refreshed) return unauthorized();
    token = refreshed.accessToken;
  }

  const body = request ? await request.text() : undefined;

  const upstream = await fetch(endpoint(), {
    method,
    body,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(request ? { "content-type": "application/json" } : {}),
    },
  });
  const response = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) {
    response.cookies.set(
      ACCESS_TOKEN_COOKIE,
      refreshed.accessToken,
      authCookieOptions(refreshed.expiresIn),
    );
  }
  return response;
}

function unauthorized(): NextResponse {
  const response = NextResponse.json({ error: "unauthorized" }, { status: 401 });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  return response;
}

export function GET() {
  return proxy("GET");
}

export function POST(request: NextRequest) {
  return proxy("POST", request);
}
