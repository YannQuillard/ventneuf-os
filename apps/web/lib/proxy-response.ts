import { NextResponse } from "next/server";

export function proxyResponse(upstream: Response) {
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
