import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { conversations, devices, members, messages, missionEvents, missions, organizations } from "./schema.js";

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
    runner?: { deviceId: string; repositoryId: string; adapter?: "repository-check" | "orca-review" };
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
        if (!device?.repositories.some(({ id, orcaReview }) => id === input.runner!.repositoryId
          && (input.runner!.adapter !== "orca-review" || orcaReview === true))) {
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
      if (cancelled[0]?.assignedDeviceId) {
        await transaction.insert(missionEvents).values({ organizationId, missionId,
          type: "run.cancelled", payload: { executor: "runner" }, occurredAt: cancelledAt });
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
