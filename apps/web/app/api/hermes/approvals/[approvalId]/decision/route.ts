import { NextRequest } from "next/server";
import { proxyControlPlane } from "../../../../../../lib/control-plane";

export async function POST(request: NextRequest, context: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await context.params;
  return proxyControlPlane(
    `/api/conversations/hermes/approvals/${encodeURIComponent(approvalId)}/decision`,
    "POST",
    request,
  );
}
