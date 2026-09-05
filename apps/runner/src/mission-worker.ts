import { randomUUID } from "node:crypto";
import type { CredentialStore, StoredDevice } from "./credential-store.js";
import type { MissionAdapter, ReadOnlyMission, RegisteredRepository } from "./repositories.js";

export interface ClaimedMission extends ReadOnlyMission {
  leaseToken: string;
  leaseExpiresAt: string;
  attempt: number;
  approvalDecision?: {
    id: string;
    requestId: string;
    status: "approved" | "rejected" | "expired";
    action: {
      category: string;
      target: string;
      argumentsDigest: string;
      summary: string;
      expectedEffect: string;
    };
    resume: { adapter: "codex" | "claude"; sessionId: string };
    rationale?: string;
  };
}
export interface RunnerApprovalRequest {
  owner: string;
  token: string;
  requestId: string;
  action: {
    category: "repository.write" | "development.command" | "network.access"
      | "pull_request.create" | "pull_request.merge" | "deployment.apply" | "connector.write";
    target: string;
    argumentsDigest: string;
    summary: string;
    expectedEffect: string;
  };
  reason: string;
  evidence: Record<string, unknown>;
  resume: { adapter: "codex" | "claude"; sessionId: string };
}
export interface RunnerApprovalResponse {
  approval: {
    id: string;
    route: "automatic" | "hermes" | "human";
    status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
    expiresAt: string;
  };
}
export interface MissionReport {
  owner: string;
  token: string;
  eventId: string;
  kind: "progress" | "completed" | "failed";
  content: string;
}
export interface MissionClient {
  registerRepositories(device: StoredDevice, repositories: Array<{ id: string; name: string; orcaReview?: boolean }>): Promise<void>;
  claimMission(device: StoredDevice, owner: string): Promise<ClaimedMission | null>;
  reportMission(device: StoredDevice, missionId: string, report: MissionReport): Promise<void>;
  renewMission?(device: StoredDevice, missionId: string, lease: { owner: string; token: string }): Promise<string>;
  requestApproval?(device: StoredDevice, missionId: string, request: RunnerApprovalRequest): Promise<RunnerApprovalResponse>;
}

export class RunnerMissionWorker {
  private readonly owner = randomUUID();
  private busy = false;
  constructor(private readonly options: {
    client: MissionClient;
    store: CredentialStore;
    repositories: () => Promise<RegisteredRepository[]>;
    adapter: MissionAdapter;
    renewalIntervalMs?: number;
  }) {}

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const device = await this.options.store.load();
      if (!device) return;
      const repositories = await this.options.repositories();
      await this.options.client.registerRepositories(device, repositories.map(({ id, name, orcaReview }) =>
        ({ id, name, ...(orcaReview ? { orcaReview } : {}) })));
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
      await report("progress", mission.adapter === "orca-review"
        ? "Preparing a read-only code review with Orca." : "Checking the registered repository in read-only mode.");
      let result: string;
      const controller = new AbortController();
      let leaseExpiresAt = Date.parse(mission.leaseExpiresAt);
      const deadline = Date.now() + (mission.adapter === "orca-review" ? 300_000 : 10_000);
      let stopped = false;
      let renewal: Promise<void> = Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expiryTimer = setInterval(() => {
        if (Date.now() >= Math.min(deadline, leaseExpiresAt)) controller.abort(new LeaseRejectedError("Execution deadline reached."));
      }, 100);
      const renew = async () => {
        if (stopped || controller.signal.aborted) return;
        try {
          if (!this.options.client.renewMission) throw new Error("Lease renewal unavailable.");
          const next = Date.parse(await this.options.client.renewMission(device, mission.id, { owner: this.owner, token: mission.leaseToken }));
          if (!Number.isFinite(next) || next <= Date.now()) throw new LeaseRejectedError("Lease expired.");
          leaseExpiresAt = next;
          if (!stopped) timer = setTimeout(() => { renewal = renew(); }, this.options.renewalIntervalMs ?? 15_000);
        } catch (error) { controller.abort(error); }
      };
      try {
        const repository = repositories.find(({ id }) => id === mission.repositoryId);
        if (!repository) throw new Error("Repository unavailable.");
        if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= Date.now()) throw new LeaseRejectedError("Lease expired.");
        if (mission.adapter === "orca-review") {
          if (!repository.orcaReview) throw new Error("Orca review is not enabled for this repository.");
          await renew();
        }
        controller.signal.throwIfAborted();
        result = await this.options.adapter.execute(mission, repository, controller.signal, {
          leaseExpiresAt: () => Math.min(deadline, leaseExpiresAt),
          progress: (content) => report("progress", content),
        });
        controller.signal.throwIfAborted();
      } catch {
        await report("failed", "The read-only mission could not complete. Verify the local runner and repository configuration.");
        return;
      } finally {
        stopped = true;
        if (timer) clearTimeout(timer);
        clearInterval(expiryTimer);
        await renewal;
      }
      controller.signal.throwIfAborted();
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
