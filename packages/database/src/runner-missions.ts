import { hasWorkspaceMissionAuthority } from "./workspace-access.js";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { claudeModelAliases, evaluateApprovalPolicy, isAgentExecutionSnapshot, reasoningEfforts, type AgentExecutionSnapshot, type MissionHistoryEntry, isMissionHistoryBatch, type ClaudeModel, type MissionExecutionPreferences, type ReasoningEffort, type RunnerExecutionHarnesses } from "@ventneuf/domain";
import type { Database, DatabaseTransaction } from "./client.js";
import { deviceCredentials, devices, conversations, messages, missionApprovals, missionEvents, missionHistory, missions } from "./schema.js";

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

  private async cancelWithdrawnWorkspaceMission(
    transaction: DatabaseTransaction,
    mission: typeof missions.$inferSelect,
    now: Date,
  ) {
    const [cancelled] = await transaction.update(missions).set({
      status: "cancelled",
      leaseOwner: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      updatedAt: now,
      context: { ...mission.context, cancellationReason: "Project access or repository association was withdrawn." },
    }).where(and(
      eq(missions.organizationId, mission.organizationId),
      eq(missions.id, mission.id),
      inArray(missions.status, ["queued", "running", "waiting_for_approval"]),
    )).returning({ id: missions.id });
    if (cancelled) {
      await transaction.insert(missionEvents).values({
        organizationId: mission.organizationId,
        missionId: mission.id,
        type: "run.cancelled",
        payload: { reason: "project_access_withdrawn" },
        occurredAt: now,
      });
    }
  }

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
    github?: { id?: string; owner: string; name: string };
  }>, executionHarnesses: RunnerExecutionHarnesses) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      await transaction.update(devices).set({ repositories, executionHarnesses, updatedAt: new Date() }).where(and(
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
        if (!await hasWorkspaceMissionAuthority(transaction, mission)) {
          await transaction.update(missions).set({ status: "cancelled", leaseExpiresAt: null, updatedAt: now,
            context: { ...mission.context, cancellationReason: "Project access or repository association was withdrawn." },
          }).where(eq(missions.id, mission.id));
          await transaction.insert(missionEvents).values({ organizationId: scope.organizationId,
            missionId: mission.id, type: "run.cancelled", payload: { reason: "project_access_withdrawn" }, occurredAt: now });
          continue;
        }
        const adapter = mission.context.type === "runner.orca-review"
          ? "orca-review"
          : mission.context.type === "runner.codex-development"
            ? "codex-development"
            : mission.context.type === "runner.claude-development"
              ? "claude-development"
            : "repository-check";
        const authority = mission.context.authority as { expiresAt?: unknown } | undefined;
        const agent = mission.context.agent as { model?: unknown; reasoningEffort?: unknown; subagents?: unknown } | undefined;
        const model = agent?.model;
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
        if (adapter === "claude-development"
          && !claudeModelAliases.includes(model as ClaudeModel)) {
          await transaction.update(missions).set({ status: "failed", leaseExpiresAt: null, updatedAt: now,
            context: { ...mission.context, failure: "Claude model authorization is unavailable." },
          }).where(eq(missions.id, mission.id));
          await transaction.insert(missionEvents).values({ organizationId: scope.organizationId,
            missionId: mission.id, type: "run.failed", payload: { reason: "claude_model_unavailable" }, occurredAt: now });
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
        const reasoningEffort = agent?.reasoningEffort;
        return { id: mission.id, repositoryId: mission.context.repositoryId, objective: mission.goal,
          adapter, attempt: mission.attempts + 1, leaseExpiresAt: expiresAt.toISOString(),
          ...(["codex-development", "claude-development"].includes(adapter) && typeof agent?.model === "string"
            ? { model: agent.model } : {}),
          ...(typeof reasoningEffort === "string" && reasoningEfforts.includes(reasoningEffort as ReasoningEffort)
            ? { reasoningEffort: reasoningEffort as ReasoningEffort } : {}),
          ...(["codex-development", "claude-development"].includes(adapter) && agent?.subagents
            ? { subagents: agent.subagents as MissionExecutionPreferences["subagents"] } : {}),
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
      if (!await hasWorkspaceMissionAuthority(transaction, mission)) {
        throw new RunnerLeaseError("Project access or repository association was withdrawn.");
      }
      const expiresAt = new Date(now.getTime() + leaseDurationMs);
      await transaction.update(missions).set({ leaseExpiresAt: expiresAt, updatedAt: now }).where(eq(missions.id, mission.id));
      return { leaseExpiresAt: expiresAt.toISOString() };
    });
  }

  inspect(scope: DeviceScope, missionId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId),
        eq(missions.id, missionId),
        eq(missions.assignedDeviceId, scope.deviceId),
      )).for("update").limit(1);
      if (mission && !await hasWorkspaceMissionAuthority(transaction, mission)) {
        await this.cancelWithdrawnWorkspaceMission(transaction, mission, new Date());
        return { status: "cancelled" };
      }
      return mission ? { status: mission.status } : undefined;
    });
  }

  /** Assigned devices may finish uploading diagnostics after execution ends. This grants no execution authority. */
  history(scope: DeviceScope, missionId: string, entries: MissionHistoryEntry[]) {
    if (!isMissionHistoryBatch(entries)) throw new RunnerLeaseError("Invalid history batch.");
    return this.database.withOrganization(scope.organizationId, async transaction => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId), eq(missions.id, missionId),
        eq(missions.assignedDeviceId, scope.deviceId), gt(missions.attempts, 0),
      )).for("update").limit(1);
      const [conversation] = mission ? await transaction.select({ id: conversations.id }).from(conversations).where(and(
        eq(conversations.organizationId, scope.organizationId), eq(conversations.id, mission.conversationId), isNull(conversations.deletedAt),
      )).limit(1) : [];
      if (!mission || !conversation || !await hasWorkspaceMissionAuthority(transaction, mission)
        || entries.some(entry => mission.context.type !== `runner.${entry.provider}-development`)) {
        throw new RunnerLeaseError("History is outside the assigned mission.");
      }
      for (const entry of entries) {
        const [existing] = await transaction.select().from(missionHistory).where(and(
          eq(missionHistory.organizationId, scope.organizationId), eq(missionHistory.missionId, missionId),
          eq(missionHistory.eventId, entry.id),
        )).limit(1);
        if (existing) {
          // JSONB key order is not stable; compare canonically in PostgreSQL.
          const [same] = await transaction.select({ cursor: missionHistory.cursor }).from(missionHistory).where(and(
            eq(missionHistory.cursor, existing.cursor), sql`${missionHistory.entry} = ${JSON.stringify(entry)}::jsonb`,
          ));
          if (!same) throw new RunnerLeaseError("A recorded history event cannot be changed.");
        } else await transaction.insert(missionHistory).values({ organizationId: scope.organizationId,
          missionId, eventId: entry.id, entry });
      }
      return { accepted: entries.map(entry => entry.id) };
    });
  }

  execution(scope: DeviceScope, input: {
    missionId: string; owner: string; tokenHash: string; snapshot: AgentExecutionSnapshot;
  }) {
    if (!isAgentExecutionSnapshot(input.snapshot)) throw new RunnerLeaseError("Invalid execution snapshot.");
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId), eq(missions.id, input.missionId),
        eq(missions.assignedDeviceId, scope.deviceId), eq(missions.leaseOwner, input.owner),
        eq(missions.leaseTokenHash, input.tokenHash),
      )).for("update").limit(1);
      if (!mission || mission.context.type !== `runner.${input.snapshot.provider}-development`) {
        throw new RunnerLeaseError("The execution is outside the runner lease.");
      }
      const now = new Date();
      if (mission.status !== "running" || !mission.leaseExpiresAt || mission.leaseExpiresAt <= now) {
        throw new RunnerLeaseError("The runner lease expired or the mission stopped.");
      }
      if (!await hasWorkspaceMissionAuthority(transaction, mission)) {
        await this.cancelWithdrawnWorkspaceMission(transaction, mission, now);
        return undefined;
      }
      const [existing] = await transaction.select().from(missionEvents).where(and(
        eq(missionEvents.organizationId, scope.organizationId), eq(missionEvents.missionId, mission.id),
        eq(missionEvents.id, mission.id), eq(missionEvents.type, "runner.execution"),
      )).limit(1);
      const previous = existing?.payload.snapshot as AgentExecutionSnapshot | undefined;
      if (previous && previous.revision >= input.snapshot.revision) return { revision: previous.revision };
      // A single bounded materialized view survives completion without growing SSE snapshots per delta.
      if (existing) {
        await transaction.update(missionEvents).set({ payload: { snapshot: input.snapshot }, occurredAt: now })
          .where(and(eq(missionEvents.id, mission.id), eq(missionEvents.organizationId, scope.organizationId)));
      } else {
        await transaction.insert(missionEvents).values({ id: mission.id, missionId: mission.id,
          organizationId: scope.organizationId, type: "runner.execution", payload: { snapshot: input.snapshot }, occurredAt: now });
      }
      return { revision: input.snapshot.revision };
    }).then((result) => {
      if (!result) throw new RunnerLeaseError("Project access or repository association was withdrawn.");
      return result;
    });
  }

  report(scope: DeviceScope, input: {
    missionId: string;
    owner: string;
    tokenHash: string;
    eventId: string;
    kind: "progress" | "completed" | "failed";
    content: string;
    snapshot?: AgentExecutionSnapshot;
  }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await this.authenticate(transaction, scope);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId), eq(missions.id, input.missionId),
        eq(missions.assignedDeviceId, scope.deviceId), eq(missions.leaseOwner, input.owner),
        eq(missions.leaseTokenHash, input.tokenHash),
      )).for("update").limit(1);
      if (!mission) throw new RunnerLeaseError("The runner lease is unavailable.");
      const now = new Date();
      if (!await hasWorkspaceMissionAuthority(transaction, mission)) {
        await this.cancelWithdrawnWorkspaceMission(transaction, mission, now);
        return undefined;
      }
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
      if (mission.status !== "running" || !mission.leaseExpiresAt || mission.leaseExpiresAt <= now) {
        throw new RunnerLeaseError("The runner lease expired or the mission stopped.");
      }
      if (input.snapshot) {
        if (!isAgentExecutionSnapshot(input.snapshot)
          || mission.context.type !== `runner.${input.snapshot.provider}-development`) {
          throw new RunnerLeaseError("Invalid execution snapshot.");
        }
        await transaction.insert(missionEvents).values({ id: mission.id, missionId: mission.id,
          organizationId: scope.organizationId, type: "runner.execution", payload: { snapshot: input.snapshot }, occurredAt: now,
        }).onConflictDoUpdate({ target: missionEvents.id,
          set: { payload: { snapshot: input.snapshot }, occurredAt: now },
          setWhere: and(eq(missionEvents.organizationId, scope.organizationId), eq(missionEvents.missionId, mission.id),
            eq(missionEvents.type, "runner.execution"),
            sql`coalesce((${missionEvents.payload}->'snapshot'->>'revision')::bigint, 0) < ${input.snapshot.revision}`),
        });
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
    }).then((result) => {
      if (!result) throw new RunnerLeaseError("Project access or repository association was withdrawn.");
      return result;
    });
  }
}
