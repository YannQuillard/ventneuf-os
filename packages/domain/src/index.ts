export type PrincipalType = "user" | "device" | "mission";

export type Capability =
  | "system:identity:read"
  | "knowledge:shared:read"
  | "knowledge:personal:read"
  | "mission:read"
  | "mission:progress:write"
  | "device:manage"
  | "device:heartbeat"
  | "hermes:ask";

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
