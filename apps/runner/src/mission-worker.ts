import { randomUUID } from "node:crypto";
import type { CredentialStore, StoredDevice } from "./credential-store.js";
import type { MissionAdapter, ReadOnlyMission, RegisteredRepository } from "./repositories.js";

export interface ClaimedMission extends ReadOnlyMission {
  leaseToken: string;
  leaseExpiresAt: string;
  attempt: number;
}
export interface MissionReport {
  owner: string;
  token: string;
  eventId: string;
  kind: "progress" | "completed" | "failed";
  content: string;
}
export interface MissionClient {
  registerRepositories(device: StoredDevice, repositories: Array<{ id: string; name: string }>): Promise<void>;
  claimMission(device: StoredDevice, owner: string): Promise<ClaimedMission | null>;
  reportMission(device: StoredDevice, missionId: string, report: MissionReport): Promise<void>;
}

export class RunnerMissionWorker {
  private readonly owner = randomUUID();
  private busy = false;
  constructor(private readonly options: {
    client: MissionClient;
    store: CredentialStore;
    repositories: () => Promise<RegisteredRepository[]>;
    adapter: MissionAdapter;
  }) {}

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const device = await this.options.store.load();
      if (!device) return;
      const repositories = await this.options.repositories();
      await this.options.client.registerRepositories(device, repositories.map(({ id, name }) => ({ id, name })));
      const mission = await this.options.client.claimMission(device, this.owner);
      if (!mission) return;
      const report = async (kind: MissionReport["kind"], content: string) => {
        const event: MissionReport = { owner: this.owner, token: mission.leaseToken, eventId: randomUUID(), kind, content };
        // A retry keeps its event ID so a lost response cannot duplicate the durable result.
        for (let attempt = 0; ; attempt += 1) {
          try { await this.options.client.reportMission(device, mission.id, event); return; }
          catch (error) {
            if (attempt >= 2 || error instanceof LeaseRejectedError) throw error;
          }
        }
      };
      await report("progress", "Checking the registered repository in read-only mode.");
      let result: string;
      try {
        const repository = repositories.find(({ id }) => id === mission.repositoryId);
        if (!repository) throw new Error("Repository unavailable.");
        const remainingMs = Date.parse(mission.leaseExpiresAt) - Date.now();
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw new Error("Lease expired.");
        result = await this.options.adapter.execute(mission, repository, AbortSignal.timeout(Math.min(10_000, remainingMs)));
      } catch {
        await report("failed", "The read-only repository check could not complete. Verify the local repository registration.");
        return;
      }
      await report("completed", result);
    } finally { this.busy = false; }
  }

  start(intervalMs = 5_000) {
    const tick = () => { void this.tick().catch(() => console.error("Runner mission polling failed.")); };
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

export class LeaseRejectedError extends Error {}
