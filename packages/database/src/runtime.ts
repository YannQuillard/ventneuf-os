import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { conversations, members, messages, missions, organizations } from "./schema.js";

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
  }) {
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
          context: { sourceMessageId: message.id, type: "hermes.conversation" },
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

  setMissionRunning(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction
        .update(missions)
        .set({ status: "running", updatedAt: new Date() })
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId))),
    );
  }

  completeMission(input: {
    organizationId: string;
    missionId: string;
    conversationId: string;
    contextId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
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
      await transaction
        .update(missions)
        .set({ status: "completed", updatedAt: new Date() })
        .where(and(eq(missions.organizationId, input.organizationId), eq(missions.id, input.missionId)));
    });
  }

  failMission(organizationId: string, missionId: string, reason: string) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction
        .update(missions)
        .set({ status: "failed", context: { failure: reason }, updatedAt: new Date() })
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId))),
    );
  }
}
