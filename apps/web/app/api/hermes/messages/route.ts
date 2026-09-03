import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "../../../../lib/auth/session";

function endpoint(): URL {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) throw new Error("CONTROL_PLANE_URL is required.");
  return new URL("/api/conversations/hermes/messages", baseUrl);
}

async function proxy(method: "GET" | "POST", request?: NextRequest) {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const upstream = await fetch(endpoint(), {
    method,
    body: request ? await request.text() : undefined,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(request ? { "content-type": "application/json" } : {}),
    },
  });
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export function GET() {
  return proxy("GET");
}

export function POST(request: NextRequest) {
  return proxy("POST", request);
}
