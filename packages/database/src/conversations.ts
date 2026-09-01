import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { conversations, messages } from "./schema.js";

export class ConversationRepository {
  constructor(private readonly database: Database) {}

  async create(input: {
    organizationId: string;
    title?: string;
  } & ({ ownerMemberId: string; channelId?: never } | { channelId: string; ownerMemberId?: never })) {
    const [conversation] = await this.database.insert(conversations).values(input).returning();
    if (!conversation) throw new Error("Failed to create the conversation.");
    return conversation;
  }

  async getAuthorized(conversationId: string, organizationId: string) {
    const [conversation] = await this.database
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
      .limit(1);
    return conversation;
  }

  async appendMessage(input: {
    conversationId: string;
    memberId?: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    const [message] = await this.database.insert(messages).values(input).returning();
    if (!message) throw new Error("Failed to append the message.");
    return message;
  }

  listMessages(conversationId: string) {
    return this.database
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
  }

  async setHermesContext(conversationId: string, contextId: string) {
    await this.database
      .update(conversations)
      .set({ hermesContextId: contextId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }
}
