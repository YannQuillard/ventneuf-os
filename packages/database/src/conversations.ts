import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { conversations, messages } from "./schema.js";

export class ConversationRepository {
  constructor(
    private readonly database: Database,
    private readonly organizationId: string,
  ) {}

  async create(input: {
    title?: string;
  } & ({ ownerMemberId: string; channelId?: never } | { channelId: string; ownerMemberId?: never })) {
    return this.database.withOrganization(this.organizationId, async (transaction) => {
      const [conversation] = await transaction
        .insert(conversations)
        .values({ ...input, organizationId: this.organizationId })
        .returning();
      if (!conversation) throw new Error("Failed to create the conversation.");
      return conversation;
    });
  }

  getAuthorized(conversationId: string) {
    return this.database.withOrganization(this.organizationId, async (transaction) => {
      const [conversation] = await transaction
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.organizationId, this.organizationId),
          ),
        )
        .limit(1);
      return conversation;
    });
  }

  async appendMessage(input: {
    conversationId: string;
    memberId?: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.database.withOrganization(this.organizationId, async (transaction) => {
      const [conversation] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.organizationId, this.organizationId),
          ),
        )
        .limit(1);
      if (!conversation) throw new Error("Conversation not found or access denied.");

      const [message] = await transaction
        .insert(messages)
        .values({ ...input, organizationId: this.organizationId })
        .returning();
      if (!message) throw new Error("Failed to append the message.");
      return message;
    });
  }

  listMessages(conversationId: string) {
    return this.database.withOrganization(this.organizationId, (transaction) =>
      transaction
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, this.organizationId),
            eq(messages.conversationId, conversationId),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id)),
    );
  }

  setHermesContext(conversationId: string, contextId: string) {
    return this.database.withOrganization(this.organizationId, async (transaction) => {
      const updated = await transaction
        .update(conversations)
        .set({ hermesContextId: contextId, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.organizationId, this.organizationId),
          ),
        )
        .returning({ id: conversations.id });
      if (updated.length === 0) throw new Error("Conversation not found or access denied.");
    });
  }
}
