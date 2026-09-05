export type PrincipalType = "user" | "service" | "device" | "mission";

export type Capability =
  | "system:identity:read"
  | "knowledge:shared:read"
  | "knowledge:personal:read"
  | "mission:create"
  | "mission:dispatch"
  | "mission:read"
  | "mission:progress:write"
  | "approval:decide"
  | "device:manage"
  | "device:heartbeat"
  | "hermes:ask";

export const approvalActionCategories = [
  "repository.write",
  "development.command",
  "network.access",
  "pull_request.create",
  "pull_request.merge",
  "deployment.apply",
  "connector.write",
] as const;

export type ApprovalActionCategory = typeof approvalActionCategories[number];
export type ApprovalPolicyDecision = "allow" | "hermes" | "human" | "deny";

export interface MissionAuthority {
  version: 1;
  expiresAt: string;
  actions: Partial<Record<ApprovalActionCategory, ApprovalPolicyDecision>>;
}

export interface ApprovalAction {
  category: ApprovalActionCategory;
  target: string;
  argumentsDigest: string;
  summary: string;
  expectedEffect: string;
}

export function evaluateApprovalPolicy(
  authority: unknown,
  category: ApprovalActionCategory,
  now = new Date(),
): ApprovalPolicyDecision {
  if (!authority || typeof authority !== "object") return "deny";
  const candidate = authority as Partial<MissionAuthority>;
  if (candidate.version !== 1 || typeof candidate.expiresAt !== "string"
    || !Number.isFinite(Date.parse(candidate.expiresAt))
    || Date.parse(candidate.expiresAt) <= now.getTime()
    || !candidate.actions || typeof candidate.actions !== "object") return "deny";
  const decision = candidate.actions[category];
  return decision === "allow" || decision === "hermes" || decision === "human"
    ? decision
    : "deny";
}

export interface AuthorizationContext {
  organizationId: string;
  principalId: string;
  principalType: PrincipalType;
  memberId?: string;
  deviceId?: string;
  missionId?: string;
  projectIds: string[];
  capabilities: Capability[];
  expiresAt: string;
}

export function assertAuthorized(
  context: AuthorizationContext,
  capability: Capability,
  now = new Date(),
): void {
  if (new Date(context.expiresAt).getTime() <= now.getTime()) {
    throw new Error("The authorization context has expired.");
  }
  if (!context.capabilities.includes(capability)) {
    throw new Error(`Missing capability: ${capability}`);
  }
}

export function publicIdentity(context: AuthorizationContext) {
  return {
    organizationId: context.organizationId,
    principalId: context.principalId,
    principalType: context.principalType,
    memberId: context.memberId,
    deviceId: context.deviceId,
    missionId: context.missionId,
    projectIds: context.projectIds,
    capabilities: context.capabilities,
    expiresAt: context.expiresAt,
  };
}
