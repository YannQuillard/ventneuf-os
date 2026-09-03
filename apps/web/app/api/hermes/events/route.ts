import { streamControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

export function GET() {
  return streamControlPlane("/api/conversations/hermes/events");
}
