import type { NextRequest } from "next/server";
import { proxyControlPlane } from "../../../../lib/control-plane";

export function POST(request: NextRequest) {
  return proxyControlPlane("/api/missions/runner", "POST", request);
}
