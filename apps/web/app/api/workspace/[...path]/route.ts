import { NextRequest, NextResponse } from "next/server";
import { proxyControlPlane, streamControlPlane } from "../../../../lib/control-plane";
import { isSameOriginMutation } from "../../../../lib/request-security";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const allowedRoutes: Array<{ method: Method; pattern: RegExp }> = [
  { method: "GET", pattern: /^$/ },
  { method: "GET", pattern: /^members$/ },
  { method: "GET", pattern: /^conversations\/[^/]+\/missions\/[^/]+\/history$/ },
  { method: "PATCH", pattern: /^me$/ },
  { method: "GET", pattern: /^memory$/ },
  { method: "GET", pattern: /^memory\/[^/]+$/ },
  { method: "GET", pattern: /^projects\/[^/]+$/ },
  { method: "POST", pattern: /^projects$/ },
  { method: "PATCH", pattern: /^projects\/[^/]+$/ },
  { method: "PUT", pattern: /^projects\/[^/]+\/members\/[^/]+$/ },
  { method: "DELETE", pattern: /^projects\/[^/]+\/members\/[^/]+$/ },
  { method: "GET", pattern: /^conversations\/[^/]+$/ },
  { method: "POST", pattern: /^conversations$/ },
  { method: "PATCH", pattern: /^conversations\/[^/]+$/ },
  { method: "DELETE", pattern: /^conversations\/[^/]+$/ },
  { method: "PUT", pattern: /^conversations\/[^/]+\/members\/[^/]+$/ },
  { method: "DELETE", pattern: /^conversations\/[^/]+\/members\/[^/]+$/ },
  { method: "GET", pattern: /^conversations\/[^/]+\/messages$/ },
  { method: "POST", pattern: /^conversations\/[^/]+\/messages$/ },
  { method: "GET", pattern: /^conversations\/[^/]+\/events$/ },
  { method: "POST", pattern: /^conversations\/[^/]+\/missions\/[^/]+\/cancel$/ },
];

function requestedPath(segments: string[] | undefined): string | null {
  if (!segments) return "";
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/"))) return null;
  return segments.map(encodeURIComponent).join("/");
}

async function forward(request: NextRequest, context: { params: Promise<{ path?: string[] }> }, method: Method) {
  const { path: segments } = await context.params;
  const path = requestedPath(segments);
  if (path === null || !allowedRoutes.some((route) => route.method === method && route.pattern.test(path))) {
    return NextResponse.json({ error: "workspace_route_not_found" }, { status: 404 });
  }
  if (method !== "GET" && !isSameOriginMutation(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const scopeConversationId = method === "GET" && /^memory(?:\/|$)/.test(path)
    ? request.nextUrl.searchParams.get("conversationId")
    : null;
  const upstreamPath = `/api/workspace${path ? `/${path}` : ""}${scopeConversationId ? `?conversationId=${encodeURIComponent(scopeConversationId)}` : ""}`;
  if (method === "GET" && /\/history$/.test(path)) {
    const after = request.nextUrl.searchParams.get("after") ?? "0";
    return proxyControlPlane(`${upstreamPath}?after=${encodeURIComponent(after)}`, "GET");
  }
  if (method === "GET" && /\/events$/.test(path)) return streamControlPlane(upstreamPath);
  return proxyControlPlane(upstreamPath, method, method === "GET" ? undefined : request);
}

type RouteContext = { params: Promise<{ path?: string[] }> };

export function GET(request: NextRequest, context: RouteContext) { return forward(request, context, "GET"); }
export function POST(request: NextRequest, context: RouteContext) { return forward(request, context, "POST"); }
export function PATCH(request: NextRequest, context: RouteContext) { return forward(request, context, "PATCH"); }
export function PUT(request: NextRequest, context: RouteContext) { return forward(request, context, "PUT"); }
export function DELETE(request: NextRequest, context: RouteContext) { return forward(request, context, "DELETE"); }
