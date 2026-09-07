import { NextRequest, NextResponse } from "next/server";
import { proxyControlPlane } from "../../../../lib/control-plane";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/devices?github=error", request.url));
  const result = await proxyControlPlane("/api/github/callback", "POST", undefined, JSON.stringify({ code, state }));
  return NextResponse.redirect(new URL(result.ok ? "/devices?github=connected" : "/devices?github=error", request.url));
}
