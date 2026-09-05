import { LeaseRejectedError, type ClaimedMission, type MissionReport } from "./mission-worker.js";
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
      || typeof mission.repositoryId !== "string" || !["repository-check", "orca-review"].includes(mission.adapter)
      || typeof mission.leaseToken !== "string" || !/^[a-f0-9]{64}$/.test(mission.leaseToken)
      || !Number.isFinite(Date.parse(mission.leaseExpiresAt))) throw new Error("Invalid runner mission response.");
    return mission;
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
