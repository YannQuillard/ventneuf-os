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
