import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "./client.js";
import { deviceCredentials, devices, messages, missionEvents, missions } from "./schema.js";

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

  register(scope: DeviceScope, repositories: Array<{ id: string; name: string }>) {
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
          sql`${missions.context}->>'type' = 'runner.repository-check'`,
          or(eq(missions.status, "queued"), and(eq(missions.status, "running"), lte(missions.leaseExpiresAt, now))),
        )).orderBy(asc(missions.createdAt), asc(missions.id)).for("update", { skipLocked: true }).limit(1);
        if (!mission) return null;
        if (mission.attempts >= maxAttempts) {
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
        return { id: mission.id, repositoryId: mission.context.repositoryId,
          adapter: "repository-check" as const, attempt: mission.attempts + 1, leaseExpiresAt: expiresAt.toISOString() };
      }
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
