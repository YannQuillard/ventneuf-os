import { assertAuthorized, type AuthorizationContext } from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";
import type { MissionDelegationVerifier } from "./mission-delegation.js";

export interface ServiceApprovalDecision {
  approvalId: string;
  delegationToken: string;
  requestId: string;
  decision: "approved" | "rejected" | "escalated";
  rationale: string;
}

export async function decideApprovalAsService(
  context: AuthorizationContext,
  runtime: Pick<ConversationRuntime, "approvals">,
  input: ServiceApprovalDecision,
  delegations?: MissionDelegationVerifier,
) {
  assertAuthorized(context, "approval:decide");
  if (context.principalType !== "service" || !delegations) {
    throw new Error("Approval decisions require a delegated service principal.");
  }
  const claims = await delegations.verify(input.delegationToken);
  if (!("approvalId" in claims)
    || claims.organizationId !== context.organizationId
    || claims.serviceId !== context.principalId
    || claims.approvalId !== input.approvalId) {
    throw new Error("The approval request is outside the delegated mission scope.");
  }
  return runtime.approvals.decideByService({
    organizationId: claims.organizationId,
    serviceId: claims.serviceId,
    approvalId: claims.approvalId,
    reviewMissionId: claims.parentMissionId,
    conversationId: claims.conversationId,
    memberId: claims.memberId,
    decisionRequestId: input.requestId,
    decision: input.decision,
    rationale: input.rationale,
  });
}
