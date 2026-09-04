import { proxyControlPlane } from "../../../lib/control-plane";

export function GET() {
  return proxyControlPlane("/api/devices", "GET");
}
