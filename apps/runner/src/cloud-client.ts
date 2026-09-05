import {
  LeaseRejectedError,
  type ClaimedMission,
  type MissionReport,
  type RunnerApprovalRequest,
  type RunnerApprovalResponse,
} from "./mission-worker.js";
import type { StoredDevice } from "./credential-store.js";

interface EnrollmentResponse {
  device: {
    id: string;
    name: string;
    platform: StoredDevice["platform"];
  };
  credential: string;
}

export class RunnerCloudClient {
  constructor(private readonly baseUrl: URL) {}

  private async missionRequest(device: StoredDevice, path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST", signal: AbortSignal.timeout(8_000),
      headers: { authorization: `Bearer ${device.credential}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if ([401, 403, 409].includes(response.status)) throw new LeaseRejectedError("Runner access or lease rejected.");
    if (!response.ok) throw new Error("Runner mission request failed.");
    return response.json();
  }

  async registerRepositories(device: StoredDevice, repositories: Array<{ id: string; name: string; orcaReview?: boolean }>) {
    await this.missionRequest(device, "/api/runner/repositories", { repositories });
  }

  async claimMission(device: StoredDevice, owner: string): Promise<ClaimedMission | null> {
    const payload = await this.missionRequest(device, "/api/runner/missions/claim", { owner }) as { mission?: ClaimedMission | null };
    if (payload.mission === null) return null;
    const mission = payload.mission;
    if (!mission || typeof mission.id !== "string" || !/^[a-f0-9-]{36}$/.test(mission.id)
      || typeof mission.repositoryId !== "string" || typeof mission.objective !== "string"
      || !mission.objective.trim() || mission.objective.length > 4_000
      || !["repository-check", "orca-review"].includes(mission.adapter)
      || typeof mission.leaseToken !== "string" || !/^[a-f0-9]{64}$/.test(mission.leaseToken)
      || !Number.isFinite(Date.parse(mission.leaseExpiresAt))
      || (mission.approvalDecision !== undefined && !this.isApprovalDecision(mission.approvalDecision))) {
      throw new Error("Invalid runner mission response.");
    }
    return mission;
  }

  private isApprovalDecision(value: unknown): value is NonNullable<ClaimedMission["approvalDecision"]> {
    if (!value || typeof value !== "object") return false;
    const decision = value as Record<string, unknown>;
    const action = decision.action as Record<string, unknown> | undefined;
    const resume = decision.resume as Record<string, unknown> | undefined;
    return typeof decision.id === "string" && /^[a-f0-9-]{36}$/.test(decision.id)
      && typeof decision.requestId === "string" && /^[a-f0-9-]{36}$/.test(decision.requestId)
      && ["approved", "rejected", "expired"].includes(String(decision.status))
      && Boolean(action)
      && ["repository.write", "development.command", "network.access", "pull_request.create",
        "pull_request.merge", "deployment.apply", "connector.write"].includes(String(action?.category))
      && typeof action?.target === "string"
      && typeof action?.argumentsDigest === "string" && /^[a-f0-9]{64}$/.test(action.argumentsDigest)
      && typeof action?.summary === "string"
      && typeof action?.expectedEffect === "string"
      && Boolean(resume)
      && ["codex", "claude"].includes(String(resume?.adapter))
      && typeof resume?.sessionId === "string";
  }

  async reportMission(device: StoredDevice, missionId: string, report: MissionReport) {
    const result = await this.missionRequest(device, `/api/runner/missions/${encodeURIComponent(missionId)}/report`, report) as { status?: string };
    if (report.kind === "progress" && result.status !== "running") throw new LeaseRejectedError("The mission stopped.");
  }

  async renewMission(device: StoredDevice, missionId: string, lease: { owner: string; token: string }) {
    const result = await this.missionRequest(device, `/api/runner/missions/${encodeURIComponent(missionId)}/renew`, lease) as { leaseExpiresAt?: string };
    if (!result.leaseExpiresAt || !Number.isFinite(Date.parse(result.leaseExpiresAt))) throw new Error("Invalid runner lease response.");
    return result.leaseExpiresAt;
  }

  async requestApproval(
    device: StoredDevice,
    missionId: string,
    request: RunnerApprovalRequest,
  ): Promise<RunnerApprovalResponse> {
    const result = await this.missionRequest(
      device,
      `/api/runner/missions/${encodeURIComponent(missionId)}/approvals`,
      request,
    ) as RunnerApprovalResponse;
    if (!result.approval || typeof result.approval.id !== "string"
      || !["automatic", "hermes", "human"].includes(result.approval.route)
      || !["pending", "approved", "rejected", "cancelled", "expired"].includes(result.approval.status)
      || !Number.isFinite(Date.parse(result.approval.expiresAt))) {
      throw new Error("Invalid runner approval response.");
    }
    return result;
  }

  async enroll(token: string, name: string): Promise<StoredDevice> {
    const response = await fetch(new URL("/api/runner/enroll", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, platform: process.platform }),
    });
    if (!response.ok) throw new Error(response.status === 401
      ? "The enrollment request has expired or was already used."
      : "The device could not be enrolled.");
    const payload = await response.json() as EnrollmentResponse;
    if (!payload.credential || !payload.device?.id) throw new Error("The enrollment response is invalid.");
    return {
      deviceId: payload.device.id,
      name: payload.device.name,
      platform: payload.device.platform,
      credential: payload.credential,
    };
  }

  async heartbeat(device: StoredDevice): Promise<void> {
    const response = await fetch(new URL("/api/runner/heartbeat", this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.credential}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error("The runner credential was rejected.");
  }
}
