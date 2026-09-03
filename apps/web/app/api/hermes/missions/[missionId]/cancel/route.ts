import { NextRequest } from "next/server";
import { proxyControlPlane } from "../../../../../../lib/control-plane";

export async function POST(request: NextRequest, context: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await context.params;
  return proxyControlPlane(`/api/conversations/hermes/missions/${encodeURIComponent(missionId)}/cancel`, "POST", request);
}
