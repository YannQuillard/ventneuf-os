import { randomUUID } from "node:crypto";
import type { CredentialStore, StoredDevice } from "./credential-store.js";
import {
  MissionPausedError,
  type AgentApprovalRequest,
  type AgentApprovalResponse,
  type MissionAdapter,
  type MissionStatus,
  type RunnerMission,
  type RegisteredRepository,
} from "./repositories.js";

export interface ClaimedMission extends RunnerMission {
  leaseToken: string;
  leaseExpiresAt: string;
  attempt: number;
}
export interface RunnerApprovalRequest extends AgentApprovalRequest {
  owner: string;
  token: string;
}
export type RunnerApprovalResponse = AgentApprovalResponse;
export interface MissionReport {
  owner: string;
  token: string;
  eventId: string;
  kind: "progress" | "completed" | "failed";
  content: string;
}
export interface MissionClient {
  registerRepositories(device: StoredDevice, repositories: Array<{
    id: string;
    name: string;
    orcaReview?: boolean;
    codexDevelopment?: boolean;
    claudeDevelopment?: boolean;
  }>): Promise<void>;
  claimMission(device: StoredDevice, owner: string): Promise<ClaimedMission | null>;
  reportMission(device: StoredDevice, missionId: string, report: MissionReport): Promise<void>;
  renewMission?(device: StoredDevice, missionId: string, lease: { owner: string; token: string }): Promise<string>;
  requestApproval?(device: StoredDevice, missionId: string, request: RunnerApprovalRequest): Promise<RunnerApprovalResponse>;
  getMissionStatus?(device: StoredDevice, missionId: string): Promise<MissionStatus | undefined>;
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
      if (this.options.adapter.maintain && this.options.client.getMissionStatus) {
        await this.options.adapter.maintain({
          status: (missionId) => this.options.client.getMissionStatus!(device, missionId),
        });
      }
      await this.options.client.registerRepositories(device, repositories.map(({
        id, name, orcaReview, codexDevelopment, claudeDevelopment,
      }) => ({ id, name, ...(orcaReview ? { orcaReview } : {}), ...(codexDevelopment ? { codexDevelopment } : {}),
        ...(claudeDevelopment ? { claudeDevelopment } : {}) })));
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
        ? "Preparing a read-only code review with Orca."
        : mission.adapter === "codex-development"
          ? "Preparing an autonomous Codex development mission in Orca."
          : mission.adapter === "claude-development"
            ? "Preparing an autonomous Claude development mission in Orca."
          : "Checking the registered repository in read-only mode.");
      let result: string;
      const controller = new AbortController();
      let leaseExpiresAt = Date.parse(mission.leaseExpiresAt);
      const authorityDeadline = mission.authorityExpiresAt ? Date.parse(mission.authorityExpiresAt) : Number.NaN;
      const deadline = ["codex-development", "claude-development"].includes(mission.adapter)
        ? authorityDeadline
        : Date.now() + (mission.adapter === "orca-review" ? 300_000 : 10_000);
      let stopped = false;
      let paused = false;
      let renewal: Promise<void> = Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expiryTimer = setInterval(() => {
        if (!paused && Date.now() >= Math.min(deadline, leaseExpiresAt)) controller.abort(new LeaseRejectedError("Execution deadline reached."));
      }, 100);
      const renew = async () => {
        if (stopped || paused || controller.signal.aborted) return;
        try {
          if (!this.options.client.renewMission) throw new Error("Lease renewal unavailable.");
          const next = Date.parse(await this.options.client.renewMission(device, mission.id, { owner: this.owner, token: mission.leaseToken }));
          if (!Number.isFinite(next) || next <= Date.now()) throw new LeaseRejectedError("Lease expired.");
          leaseExpiresAt = next;
          if (!stopped) timer = setTimeout(() => { renewal = renew(); }, this.options.renewalIntervalMs ?? 15_000);
        } catch (error) { if (!paused) controller.abort(error); }
      };
      try {
        const repository = repositories.find(({ id }) => id === mission.repositoryId);
        if (!repository) throw new Error("Repository unavailable.");
        if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= Date.now()) throw new LeaseRejectedError("Lease expired.");
        if (["orca-review", "codex-development", "claude-development"].includes(mission.adapter)) {
          if (mission.adapter === "orca-review" && !repository.orcaReview) {
            throw new Error("Orca review is not enabled for this repository.");
          }
          if (mission.adapter === "codex-development" && (!repository.codexDevelopment
            || !Number.isFinite(deadline) || deadline <= Date.now())) {
            throw new Error("Codex development is not enabled or its authority expired.");
          }
          if (mission.adapter === "claude-development" && (!repository.claudeDevelopment
            || !Number.isFinite(deadline) || deadline <= Date.now())) {
            throw new Error("Claude development is not enabled or its authority expired.");
          }
          await renew();
        }
        controller.signal.throwIfAborted();
        result = await this.options.adapter.execute(mission, repository, controller.signal, {
          leaseExpiresAt: () => Math.min(deadline, leaseExpiresAt),
          progress: (content) => report("progress", content),
          requestApproval: async (request) => {
            if (!this.options.client.requestApproval) throw new Error("Mission approval requests are unavailable.");
            const response = await this.options.client.requestApproval(device, mission.id, {
              owner: this.owner,
              token: mission.leaseToken,
              ...request,
            });
            if (response.approval.status === "pending") paused = true;
            return response;
          },
        });
        controller.signal.throwIfAborted();
      } catch (error) {
        if (error instanceof MissionPausedError) return;
        await report("failed", ["codex-development", "claude-development"].includes(mission.adapter)
          ? `The ${mission.adapter === "codex-development" ? "Codex" : "Claude"} development mission could not complete. Inspect the retained Orca mission workspace for diagnostics.`
          : "The read-only mission could not complete. Verify the local runner and repository configuration.");
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
