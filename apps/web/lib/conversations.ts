export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  memberId?: string;
  memberName?: string;
}

export interface MissionTiming {
  acceptedAt?: string;
  queuedAt?: string;
  workerReceivedAt?: string;
  hermesStartedAt?: string;
  hermesCompletedAt?: string;
  persistedAt?: string;
  failedAt?: string;
  queueMs?: number;
  hermesMs?: number;
  totalMs?: number;
}

export interface MissionState {
  id: string;
  status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  timing: MissionTiming;
  failure?: string;
  canManage?: boolean;
}

export interface MissionEvent {
  id: string;
  missionId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface MissionApproval {
  id: string;
  missionId: string;
  action: {
    category: string;
    target: string;
    argumentsDigest: string;
    summary: string;
    expectedEffect: string;
  };
  reason: string;
  evidence: Record<string, unknown>;
  route: "automatic" | "hermes" | "human";
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
  rationale?: string;
  canDecide?: boolean;
}

export function formatDuration(milliseconds: number | undefined): string | undefined {
  if (milliseconds === undefined) return undefined;
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}
