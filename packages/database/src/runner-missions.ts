import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { evaluateApprovalPolicy } from "@ventneuf/domain";
import type { Database, DatabaseTransaction } from "./client.js";
import { deviceCredentials, devices, messages, missionApprovals, missionEvents, missions } from "./schema.js";

export interface DeviceScope {
  organizationId: string;
  deviceId: string;
  credentialHash: string;
}

export class RunnerAccessError extends Error {}
export class RunnerLeaseError extends Error {}

const leaseDurationMs = 60_000;
const maxAttempts = 3;

export class RunnerMissionRepository {
  constructor(private readonly database: Database) {}

  private async authenticate(transaction: DatabaseTransaction, scope: DeviceScope) {
    const [device] = await transaction.select({ id: devices.id }).from(devices)
      .innerJoin(deviceCredentials, and(
        eq(deviceCredentials.organizationId, devices.organizationId),
        eq(deviceCredentials.deviceId, devices.id),
      )).where(and(
        eq(devices.organizationId, scope.organizationId), eq(devices.id, scope.deviceId),
        eq(deviceCredentials.tokenHash, scope.credentialHash),
        isNull(devices.revokedAt), isNull(deviceCredentials.revokedAt),
      )).for("update").limit(1);
    if (!device) throw new RunnerAccessError("The device credential is invalid.");
  }

  register(scope: DeviceScope, repositories: Array<{
    id: string;
    name: string;
    orcaReview?: boolean;
    codexDevelopment?: boolean;
    claudeDevelopment?: boolean;
  }>) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      await transaction.update(devices).set({ repositories, updatedAt: new Date() }).where(and(
        eq(devices.organizationId, scope.organizationId), eq(devices.id, scope.deviceId),
      ));
    });
  }

  claim(scope: DeviceScope, owner: string, tokenHash: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const now = new Date();
      // Serialize a device's claims, including multiple runner processes on the same Mac.
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.organizationId}), hashtext(${scope.deviceId}))`);
      const active = await transaction.select({ id: missions.id }).from(missions).where(and(
        eq(missions.organizationId, scope.organizationId), eq(missions.assignedDeviceId, scope.deviceId),
        eq(missions.status, "running"), gt(missions.leaseExpiresAt, now),
      )).limit(1);
      if (active.length) return null;
      while (true) {
        const [mission] = await transaction.select().from(missions).where(and(
          eq(missions.organizationId, scope.organizationId), eq(missions.assignedDeviceId, scope.deviceId),
          sql`${missions.context}->>'type' in ('runner.repository-check', 'runner.orca-review', 'runner.codex-development', 'runner.claude-development')`,
          or(eq(missions.status, "queued"), and(eq(missions.status, "running"), lte(missions.leaseExpiresAt, now))),
        )).orderBy(asc(missions.createdAt), asc(missions.id)).for("update", { skipLocked: true }).limit(1);
        if (!mission) return null;
        const adapter = mission.context.type === "runner.orca-review"
          ? "orca-review"
          : mission.context.type === "runner.codex-development"
            ? "codex-development"
            : mission.context.type === "runner.claude-development"
              ? "claude-development"
            : "repository-check";
        const authority = mission.context.authority as { expiresAt?: unknown } | undefined;
        const authorityExpiresAt = typeof authority?.expiresAt === "string" ? Date.parse(authority.expiresAt) : Number.NaN;
        if (["codex-development", "claude-development"].includes(adapter)
          && (!Number.isFinite(authorityExpiresAt) || authorityExpiresAt <= now.getTime())) {
          await transaction.update(missions).set({ status: "failed", leaseExpiresAt: null, updatedAt: now,
            context: { ...mission.context, failure: "Development authority is unavailable or expired." },
          }).where(eq(missions.id, mission.id));
          await transaction.insert(missionEvents).values({ organizationId: scope.organizationId,
            missionId: mission.id, type: "run.failed", payload: { reason: "development_authority_expired" }, occurredAt: now });
          continue;
        }
        // Never automatically launch a second coding agent after an ambiguous execution.
        if (mission.attempts >= (adapter === "orca-review" ? 1
          : ["codex-development", "claude-development"].includes(adapter) ? 32 : maxAttempts)) {
          await transaction.update(missions).set({ status: "failed", leaseExpiresAt: null, updatedAt: now,
            context: { ...mission.context, failure: "Runner lease recovery attempts exhausted." },
          }).where(eq(missions.id, mission.id));
          await transaction.insert(missionEvents).values({ organizationId: scope.organizationId,
            missionId: mission.id, type: "run.failed", payload: { reason: "lease_attempts_exhausted" }, occurredAt: now });
          continue;
        }
        const expiresAt = new Date(now.getTime() + leaseDurationMs);
        await transaction.update(missions).set({ status: "running", leaseOwner: owner,
          leaseTokenHash: tokenHash, leaseExpiresAt: expiresAt, attempts: mission.attempts + 1, updatedAt: now,
        }).where(eq(missions.id, mission.id));
        await transaction.insert(missionEvents).values({ organizationId: scope.organizationId,
          missionId: mission.id, type: "run.started",
          payload: { executor: "runner", attempt: mission.attempts + 1 }, occurredAt: now });
        const resumeApprovalId = mission.context.resumeApprovalId;
        const [resumeApproval] = typeof resumeApprovalId === "string"
          ? await transaction.select().from(missionApprovals).where(and(
            eq(missionApprovals.organizationId, scope.organizationId),
            eq(missionApprovals.id, resumeApprovalId),
            eq(missionApprovals.missionId, mission.id),
          )).limit(1)
          : [];
        const approvedPolicy = resumeApproval?.route === "automatic"
          ? "allow"
          : resumeApproval?.route === "hermes"
            ? "hermes"
            : resumeApproval?.route === "human"
              ? ["hermes", "human"]
              : [];
        const currentPolicy = resumeApproval
          ? evaluateApprovalPolicy(mission.context.authority, resumeApproval.actionCategory, now)
          : "deny";
        if (resumeApproval?.status === "approved"
          && (resumeApproval.expiresAt <= now
            || !(Array.isArray(approvedPolicy)
              ? approvedPolicy.includes(currentPolicy)
              : approvedPolicy === currentPolicy))) {
          resumeApproval.status = "expired";
          await transaction.update(missionApprovals).set({ status: "expired", updatedAt: now })
            .where(eq(missionApprovals.id, resumeApproval.id));
          await transaction.insert(missionEvents).values({ organizationId: scope.organizationId,
            missionId: mission.id, type: "approval.expired",
            payload: { approvalId: resumeApproval.id, reason: "grant_revalidation_failed" }, occurredAt: now });
        }
        const approvalDecision = resumeApproval && ["approved", "rejected", "expired"].includes(resumeApproval.status)
          ? {
            id: resumeApproval.id,
            requestId: resumeApproval.requestId,
            status: resumeApproval.status as "approved" | "rejected" | "expired",
            action: {
              category: resumeApproval.actionCategory,
              target: resumeApproval.actionTarget,
              argumentsDigest: resumeApproval.argumentsDigest,
              summary: resumeApproval.summary,
              expectedEffect: resumeApproval.expectedEffect,
            },
            resume: resumeApproval.resumeContext,
            ...(resumeApproval.rationale ? { rationale: resumeApproval.rationale } : {}),
          }
          : undefined;
        return { id: mission.id, repositoryId: mission.context.repositoryId, objective: mission.goal,
          adapter, attempt: mission.attempts + 1, leaseExpiresAt: expiresAt.toISOString(),
          ...(["codex-development", "claude-development"].includes(adapter) && typeof authority?.expiresAt === "string"
            ? { authorityExpiresAt: authority.expiresAt }
            : {}),
          ...(approvalDecision ? { approvalDecision } : {}) };
      }
    });
  }

  renew(scope: DeviceScope, input: { missionId: string; owner: string; tokenHash: string }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId), eq(missions.id, input.missionId),
        eq(missions.assignedDeviceId, scope.deviceId), eq(missions.leaseOwner, input.owner),
        eq(missions.leaseTokenHash, input.tokenHash),
      )).for("update").limit(1);
      const now = new Date();
      if (!mission || mission.status !== "running" || !mission.leaseExpiresAt || mission.leaseExpiresAt <= now) {
        throw new RunnerLeaseError("The runner lease expired or the mission stopped.");
      }
      const expiresAt = new Date(now.getTime() + leaseDurationMs);
      await transaction.update(missions).set({ leaseExpiresAt: expiresAt, updatedAt: now }).where(eq(missions.id, mission.id));
      return { leaseExpiresAt: expiresAt.toISOString() };
    });
  }

  inspect(scope: DeviceScope, missionId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select({ status: missions.status }).from(missions).where(and(
        eq(missions.organizationId, scope.organizationId),
        eq(missions.id, missionId),
        eq(missions.assignedDeviceId, scope.deviceId),
      )).limit(1);
      return mission;
    });
  }

  report(scope: DeviceScope, input: {
    missionId: string;
    owner: string;
    tokenHash: string;
    eventId: string;
    kind: "progress" | "completed" | "failed";
    content: string;
  }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId), eq(missions.id, input.missionId),
        eq(missions.assignedDeviceId, scope.deviceId), eq(missions.leaseOwner, input.owner),
        eq(missions.leaseTokenHash, input.tokenHash),
      )).for("update").limit(1);
      if (!mission) throw new RunnerLeaseError("The runner lease is unavailable.");
      const [existing] = await transaction.select().from(missionEvents).where(and(
        eq(missionEvents.organizationId, scope.organizationId), eq(missionEvents.missionId, mission.id),
        eq(missionEvents.id, input.eventId),
      )).limit(1);
      if (existing) {
        if (existing.payload.kind !== input.kind || existing.payload.content !== input.content) {
          throw new RunnerLeaseError("The event ID was already used.");
        }
        return { status: mission.status, leaseExpiresAt: mission.leaseExpiresAt?.toISOString() };
      }
      const now = new Date();
      if (mission.status !== "running" || !mission.leaseExpiresAt || mission.leaseExpiresAt <= now) {
        throw new RunnerLeaseError("The runner lease expired or the mission stopped.");
      }
      const status = input.kind === "progress" ? "running" : input.kind;
      const expiresAt = input.kind === "progress" ? new Date(now.getTime() + leaseDurationMs) : null;
      const timing = { totalMs: now.getTime() - mission.createdAt.getTime(), persistedAt: now.toISOString() };
      await transaction.update(missions).set({ status, leaseExpiresAt: expiresAt, updatedAt: now,
        context: { ...mission.context,
          ...(input.kind === "failed" ? { failure: input.content } : {}),
          ...(input.kind === "completed" ? { result: input.content, timing } : {}),
        },
      }).where(eq(missions.id, mission.id));
      await transaction.insert(missionEvents).values({ id: input.eventId,
        organizationId: scope.organizationId, missionId: mission.id,
        type: input.kind === "progress" ? "runner.progress" : `run.${input.kind}`,
        payload: { kind: input.kind, content: input.content, attempt: mission.attempts }, occurredAt: now,
      });
      if (input.kind === "completed") {
        await transaction.insert(messages).values({ organizationId: scope.organizationId,
          conversationId: mission.conversationId, role: "assistant", content: input.content,
          metadata: { missionId: mission.id, executor: "runner", timing },
        });
      }
      return { status, leaseExpiresAt: expiresAt?.toISOString() };
    });
  }
}
