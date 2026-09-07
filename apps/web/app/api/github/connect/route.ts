import { proxyControlPlane } from "../../../../lib/control-plane";

export function GET() {
  return proxyControlPlane("/api/github/connect", "GET");
}
