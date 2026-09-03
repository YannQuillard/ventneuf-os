export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
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
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  timing: MissionTiming;
  failure?: string;
}

export function formatDuration(milliseconds: number | undefined): string | undefined {
  if (milliseconds === undefined) return undefined;
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}
