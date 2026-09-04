import { NextRequest } from "next/server";
import { proxyControlPlane } from "../../../../lib/control-plane";

export function POST(request: NextRequest) {
  return proxyControlPlane("/api/devices/enrollments", "POST", request);
}
