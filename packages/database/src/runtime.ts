import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { MissionAuthority } from "@ventneuf/domain";
import type { Database } from "./client.js";
import { conversations, devices, members, messages, missionApprovals, missionEvents, missions, organizations } from "./schema.js";

export type DelegatedRunnerAdapter = "repository-check" | "orca-review" | "codex-development";
const developmentAuthorityMs = 2 * 60 * 60_000;

function developmentAuthority(expiresAt: Date): MissionAuthority {
  return {
    version: 1,
    expiresAt: expiresAt.toISOString(),
    actions: {
      "repository.write": "allow",
      "development.command": "hermes",
      "network.access": "hermes",
      "pull_request.create": "hermes",
      "pull_request.merge": "human",
      "deployment.apply": "human",
      "connector.write": "hermes",
    },
  };
}

export interface HermesDispatchScope {
  organizationId: string;
  parentMissionId: string;
  conversationId: string;
  memberId: string;
  targets: Array<{
    deviceId: string;
    repositoryId: string;
    adapters: DelegatedRunnerAdapter[];
  }>;
}

export class ConversationRuntimeRepository {
  constructor(private readonly database: Database) {}

  ensureOrganization(input: { id: string; slug: string; name: string }) {
    return this.database.withOrganization(input.id, (transaction) =>
      transaction.insert(organizations).values(input).onConflictDoNothing(),
    );
  }

  enqueuePrivateMessage(input: {
    organizationId: string;
    externalSubject: string;
    content: string;
    contextId?: string;
    runner?: { deviceId: string; repositoryId: string; adapter?: DelegatedRunnerAdapter };
  }) {
    const acceptedAt = new Date();
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      let [member] = await transaction
        .select()
        .from(members)
        .where(
          and(
            eq(members.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
          ),
        )
        .limit(1);

      if (!member) {
        [member] = await transaction
          .insert(members)
          .values({
            organizationId: input.organizationId,
            externalSubject: input.externalSubject,
            handle: input.externalSubject,
            displayName: "Member",
          })
          .onConflictDoNothing()
          .returning();
      }

      if (!member) {
        [member] = await transaction
          .select()
          .from(members)
          .where(
            and(
              eq(members.organizationId, input.organizationId),
              eq(members.externalSubject, input.externalSubject),
            ),
          )
          .limit(1);
      }
      if (!member) throw new Error("Failed to resolve the authenticated member.");

      // Keep concurrent submissions in the same private conversation.
      await transaction.select({ id: members.id }).from(members).where(and(
        eq(members.organizationId, input.organizationId), eq(members.id, member.id),
      )).for("update");

      if (input.runner) {
        const [device] = await transaction.select().from(devices).where(and(
          eq(devices.organizationId, input.organizationId),
          eq(devices.id, input.runner.deviceId),
          eq(devices.memberId, member.id),
          isNull(devices.revokedAt),
        )).for("share").limit(1);
        if (!device?.repositories.some(({ id, orcaReview, codexDevelopment }) => id === input.runner!.repositoryId
          && (input.runner!.adapter !== "orca-review" || orcaReview === true)
          && (input.runner!.adapter !== "codex-development" || codexDevelopment === true))) {
          throw new RunnerAssignmentError();
        }
      }

      let [conversation] = await transaction
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.ownerMemberId, member.id),
          ),
        )
        .orderBy(asc(conversations.createdAt))
        .limit(1);

      if (input.contextId !== undefined && conversation?.hermesContextId !== input.contextId) {
        throw new Error("The private conversation context is unavailable.");
      }

      if (!conversation) {
        [conversation] = await transaction
          .insert(conversations)
          .values({ organizationId: input.organizationId, ownerMemberId: member.id, title: "Hermes" })
          .returning();
      }
      if (!conversation) throw new Error("Failed to resolve the private conversation.");

      const [message] = await transaction
        .insert(messages)
        .values({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          memberId: member.id,
          role: "user",
          content: input.content,
          createdAt: acceptedAt,
        })
        .returning();
      if (!message) throw new Error("Failed to persist the message.");

      const [mission] = await transaction
        .insert(missions)
        .values({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          requestedByMemberId: member.id,
          goal: input.content,
          assignedDeviceId: input.runner?.deviceId,
          context: {
            sourceMessageId: message.id,
            type: input.runner ? `runner.${input.runner.adapter ?? "repository-check"}` : "hermes.conversation",
            ...(input.runner ? { repositoryId: input.runner.repositoryId } : {}),
            ...(input.runner?.adapter === "codex-development" ? {
              agent: { adapter: "codex" },
              authority: developmentAuthority(new Date(acceptedAt.getTime() + developmentAuthorityMs)),
            } : {}),
            timing: { acceptedAt: acceptedAt.toISOString() },
          },
          createdAt: acceptedAt,
          updatedAt: acceptedAt,
        })
        .returning();
      if (!mission) throw new Error("Failed to create the Hermes mission.");

      return { conversationId: conversation.id, message, mission };
    });
  }

  listPrivateMessages(input: { organizationId: string; externalSubject: string }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [member] = await transaction
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
          ),
        )
        .limit(1);
      if (!member) return [];

      const [conversation] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.ownerMemberId, member.id),
          ),
        )
        .orderBy(asc(conversations.createdAt))
        .limit(1);
      if (!conversation) return [];

      return transaction
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, input.organizationId),
            eq(messages.conversationId, conversation.id),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id));
    });
  }

  getLatestPrivateMission(input: { organizationId: string; externalSubject: string }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [result] = await transaction
        .select({ mission: missions })
        .from(missions)
        .innerJoin(
          members,
          and(
            eq(members.organizationId, missions.organizationId),
            eq(members.id, missions.requestedByMemberId),
          ),
        )
        .where(
          and(
            eq(missions.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
            sql`coalesce(${missions.context}->>'type', '') <> 'hermes.approval'`,
          ),
        )
        .orderBy(desc(missions.createdAt))
        .limit(1);
      return result?.mission;
    });
  }

  getMission(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, async (transaction) => {
      const [result] = await transaction
        .select({
          mission: missions,
          hermesContextId: conversations.hermesContextId,
        })
        .from(missions)
        .innerJoin(
          conversations,
          and(
            eq(conversations.organizationId, missions.organizationId),
            eq(conversations.id, missions.conversationId),
          ),
        )
        .where(
          and(eq(missions.organizationId, organizationId), eq(missions.id, missionId)),
        )
        .limit(1);
      return result;
    });
  }

  getHermesDispatchScope(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, async (transaction) => {
      const [result] = await transaction
        .select({
          mission: missions,
          ownerMemberId: conversations.ownerMemberId,
        })
        .from(missions)
        .innerJoin(conversations, and(
          eq(conversations.organizationId, missions.organizationId),
          eq(conversations.id, missions.conversationId),
        ))
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId)))
        .limit(1);
      const mission = result?.mission;
      if (!mission || !["running", "waiting_for_approval"].includes(mission.status)
        || mission.context?.type !== "hermes.conversation"
        || result.ownerMemberId !== mission.requestedByMemberId) return undefined;

      const ownedDevices = await transaction
        .select({ id: devices.id, repositories: devices.repositories })
        .from(devices)
        .where(and(
          eq(devices.organizationId, organizationId),
          eq(devices.memberId, mission.requestedByMemberId),
          isNull(devices.revokedAt),
        ));
      const targets = ownedDevices.flatMap((device) => device.repositories.map((repository) => ({
        deviceId: device.id,
        repositoryId: repository.id,
        adapters: [
          "repository-check" as const,
          ...(repository.orcaReview ? ["orca-review" as const] : []),
          ...(repository.codexDevelopment ? ["codex-development" as const] : []),
        ],
      })));
      if (targets.length > 50) throw new Error("The mission has too many runner targets to delegate.");
      return {
        organizationId,
        parentMissionId: mission.id,
        conversationId: mission.conversationId,
        memberId: mission.requestedByMemberId,
        targets,
      } satisfies HermesDispatchScope;
    });
  }

  enqueueDelegatedRunnerMission(input: {
    organizationId: string;
    parentMissionId: string;
    conversationId: string;
    memberId: string;
    serviceId: string;
    delegationId: string;
    requestId: string;
    expiresAt: Date;
    objective: string;
    deviceId: string;
    repositoryId: string;
    adapter: DelegatedRunnerAdapter;
  }) {
    const acceptedAt = new Date();
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [parent] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId),
        eq(missions.id, input.parentMissionId),
      )).for("update").limit(1);
      if (!parent || !["running", "waiting_for_approval"].includes(parent.status)
        || parent.context?.type !== "hermes.conversation"
        || parent.conversationId !== input.conversationId
        || parent.requestedByMemberId !== input.memberId
        || input.expiresAt <= acceptedAt) throw new DelegatedMissionError();

      const [conversation] = await transaction.select({ ownerMemberId: conversations.ownerMemberId })
        .from(conversations).where(and(
          eq(conversations.organizationId, input.organizationId),
          eq(conversations.id, input.conversationId),
        )).limit(1);
      if (conversation?.ownerMemberId !== input.memberId) throw new DelegatedMissionError();

      const [existing] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId),
        eq(missions.conversationId, input.conversationId),
        sql`${missions.context}->>'parentMissionId' = ${input.parentMissionId}`,
        sql`${missions.context}->'delegation'->>'id' = ${input.delegationId}`,
        sql`${missions.context}->'delegation'->>'requestId' = ${input.requestId}`,
      )).limit(1);
      if (existing) {
        if (existing.goal !== input.objective || existing.assignedDeviceId !== input.deviceId
          || existing.context?.repositoryId !== input.repositoryId
          || existing.context?.type !== `runner.${input.adapter}`) throw new DelegatedMissionError();
        return { conversationId: input.conversationId, mission: existing };
      }

      const [device] = await transaction.select().from(devices).where(and(
        eq(devices.organizationId, input.organizationId),
        eq(devices.id, input.deviceId),
        eq(devices.memberId, input.memberId),
        isNull(devices.revokedAt),
      )).for("share").limit(1);
      if (!device?.repositories.some(({ id, orcaReview, codexDevelopment }) => id === input.repositoryId
        && (input.adapter !== "orca-review" || orcaReview === true)
        && (input.adapter !== "codex-development" || codexDevelopment === true))) throw new DelegatedMissionError();

      const [mission] = await transaction.insert(missions).values({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        requestedByMemberId: input.memberId,
        assignedDeviceId: input.deviceId,
        goal: input.objective,
        context: {
          type: `runner.${input.adapter}`,
          repositoryId: input.repositoryId,
          parentMissionId: input.parentMissionId,
          delegation: {
            id: input.delegationId,
            requestId: input.requestId,
            serviceId: input.serviceId,
            capability: "mission:dispatch",
            expiresAt: input.expiresAt.toISOString(),
          },
          ...(input.adapter === "codex-development" ? {
            agent: { adapter: "codex" },
            authority: developmentAuthority(new Date(acceptedAt.getTime() + developmentAuthorityMs)),
          } : {}),
          timing: { acceptedAt: acceptedAt.toISOString() },
        },
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      }).returning();
      if (!mission) throw new Error("Failed to create the delegated runner mission.");
      await transaction.insert(missionEvents).values([
        {
          organizationId: input.organizationId,
          missionId: input.parentMissionId,
          type: "mission.child_dispatched",
          payload: {
            childMissionId: mission.id,
            serviceId: input.serviceId,
            delegationId: input.delegationId,
            requestId: input.requestId,
          },
          occurredAt: acceptedAt,
        },
        {
          organizationId: input.organizationId,
          missionId: mission.id,
          type: "mission.delegated",
          payload: {
            parentMissionId: input.parentMissionId,
            serviceId: input.serviceId,
            delegationId: input.delegationId,
            requestId: input.requestId,
          },
          occurredAt: acceptedAt,
        },
      ]);
      return { conversationId: input.conversationId, mission };
    });
  }

  setMissionQueued(organizationId: string, missionId: string, context: Record<string, unknown>) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction.update(missions).set({ context, updatedAt: new Date() }).where(and(
        eq(missions.organizationId, organizationId), eq(missions.id, missionId),
        eq(missions.status, "queued"),
      )),
    );
  }

  async setMissionRunning(organizationId: string, missionId: string, context: Record<string, unknown>) {
    const rows = await this.database.withOrganization(organizationId, (transaction) =>
      transaction.update(missions).set({ status: "running", context, updatedAt: new Date() }).where(and(
        eq(missions.organizationId, organizationId), eq(missions.id, missionId),
        // Failed deliveries can be retried by SQS; cancellation and completion are final.
        inArray(missions.status, ["queued", "running", "waiting_for_approval", "failed"]),
      )).returning({ id: missions.id }),
    );
    return rows.length > 0;
  }

  rememberCancelledHermesRun(organizationId: string, missionId: string, runId: string) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction.update(missions).set({
        context: sql`coalesce(${missions.context}, '{}'::jsonb) || ${JSON.stringify({ hermesRunId: runId })}::jsonb`,
        updatedAt: new Date(),
      }).where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId),
        eq(missions.status, "cancelled"))),
    );
  }

  completeMission(input: {
    organizationId: string;
    missionId: string;
    conversationId: string;
    contextId: string;
    content: string;
    metadata?: Record<string, unknown>;
    context: Record<string, unknown>;
  }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [completed] = await transaction
        .update(missions)
        .set({ status: "completed", context: input.context, updatedAt: new Date() })
        .where(
          and(
            eq(missions.organizationId, input.organizationId),
            eq(missions.id, input.missionId),
            inArray(missions.status, ["queued", "running", "waiting_for_approval"]),
          ),
        )
        .returning({ id: missions.id });
      if (!completed) return false;
      await transaction.insert(messages).values({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        role: "assistant",
        content: input.content,
        metadata: input.metadata,
      });
      await transaction
        .update(conversations)
        .set({ hermesContextId: input.contextId, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.id, input.conversationId),
          ),
        );
      return true;
    });
  }

  cancelMission(
    organizationId: string,
    missionId: string,
    context: Record<string, unknown>,
  ) {
    return this.database.withOrganization(organizationId, async (transaction) => {
      const cancelledAt = new Date();
      const cancelled = await transaction.update(missions)
        .set({ status: "cancelled",
          context: sql`coalesce(${missions.context}, '{}'::jsonb) || ${JSON.stringify({ cancelledAt: context.cancelledAt ?? cancelledAt.toISOString() })}::jsonb`,
          updatedAt: cancelledAt })
        .where(and(
          eq(missions.organizationId, organizationId), eq(missions.id, missionId),
          inArray(missions.status, ["queued", "running", "waiting_for_approval"]),
        ))
        .returning({ id: missions.id, assignedDeviceId: missions.assignedDeviceId, context: missions.context });
      if (!cancelled[0]) return [];
      if (cancelled[0]?.assignedDeviceId) {
        await transaction.insert(missionEvents).values({ organizationId, missionId,
          type: "run.cancelled", payload: { executor: "runner" }, occurredAt: cancelledAt });
      }
      const cancelledApprovals = await transaction.update(missionApprovals).set({
        status: "cancelled",
        updatedAt: cancelledAt,
      }).where(and(
        eq(missionApprovals.organizationId, organizationId),
        eq(missionApprovals.missionId, missionId),
        inArray(missionApprovals.status, ["pending", "approved"]),
      )).returning({ id: missionApprovals.id });
      if (cancelledApprovals.length) {
        await transaction.insert(missionEvents).values(cancelledApprovals.map(({ id }) => ({
          organizationId,
          missionId,
          type: "approval.cancelled",
          payload: { approvalId: id, reason: "mission_cancelled" },
          occurredAt: cancelledAt,
        })));
      }
      const [escalated] = await transaction.update(missionApprovals).set({
        route: "human",
        updatedAt: cancelledAt,
      }).where(and(
        eq(missionApprovals.organizationId, organizationId),
        eq(missionApprovals.reviewMissionId, missionId),
        eq(missionApprovals.status, "pending"),
        eq(missionApprovals.route, "hermes"),
      )).returning({ id: missionApprovals.id, missionId: missionApprovals.missionId });
      if (escalated) {
        await transaction.insert(missionEvents).values({
          organizationId,
          missionId: escalated.missionId,
          type: "approval.escalated",
          payload: { approvalId: escalated.id, decision: "escalated", deciderType: "system", reason: "review_cancelled" },
          occurredAt: cancelledAt,
        });
      }
      return cancelled.map(({ id, context }) => ({ id, context }));
    });
  }

  appendMissionEvent(input: {
    organizationId: string;
    missionId: string;
    type: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }) {
    return this.database.withOrganization(input.organizationId, (transaction) =>
      transaction.insert(missionEvents).values(input).returning(),
    );
  }

  listMissionEvents(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction
        .select()
        .from(missionEvents)
        .where(
          and(
            eq(missionEvents.organizationId, organizationId),
            eq(missionEvents.missionId, missionId),
          ),
        )
        .orderBy(asc(missionEvents.createdAt), asc(missionEvents.id)),
    );
  }

  failMission(
    organizationId: string,
    missionId: string,
    reason: string,
    context: Record<string, unknown>,
  ) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction
        .update(missions)
        .set({ status: "failed", context: { ...context, failure: reason }, updatedAt: new Date() })
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId),
          inArray(missions.status, ["queued", "running", "waiting_for_approval", "failed"]))),
    );
  }
}

export class RunnerAssignmentError extends Error {
  constructor() { super("The device or registered repository is unavailable."); }
}

export class DelegatedMissionError extends Error {
  constructor() { super("The delegated mission scope is unavailable."); }
}
