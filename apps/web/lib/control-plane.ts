import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "./auth/config";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, SESSION_COOKIE, authCookieOptions } from "./auth/session";
import { accessTokenNeedsRefresh, refreshAccessToken } from "./auth/token";

export async function proxyControlPlane(path: string, method: "GET" | "POST", request?: NextRequest) {
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
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) throw new Error("CONTROL_PLANE_URL is required.");
  const upstream = await fetch(new URL(path, baseUrl), {
    method,
    body: request ? await request.text() : undefined,
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, ...(request ? { "content-type": "application/json" } : {}) },
  });
  const response = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) response.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken, authCookieOptions(refreshed.expiresIn));
  return response;
}

export async function streamControlPlane(path: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessTokenNeedsRefresh(token)) return unauthorized();
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) throw new Error("CONTROL_PLANE_URL is required.");
  const upstream = await fetch(new URL(path, baseUrl), {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}

function unauthorized(): NextResponse {
  const response = NextResponse.json({ error: "unauthorized" }, { status: 401 });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  return response;
}
