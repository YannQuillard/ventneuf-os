import { proxyControlPlane } from "../../../lib/control-plane";

export function GET() {
  return proxyControlPlane("/api/github", "GET");
}

export function DELETE() {
  return proxyControlPlane("/api/github", "DELETE");
}
