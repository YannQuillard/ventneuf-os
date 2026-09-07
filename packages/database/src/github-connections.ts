import { and, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { githubConnections } from "./schema.js";
import { requireWorkspaceMember, type WorkspaceScope } from "./workspace.js";

export class GitHubConnectionRepository {
  constructor(private readonly database: Database) {}

  get(scope: WorkspaceScope) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      const [connection] = await transaction.select().from(githubConnections).where(and(
        eq(githubConnections.organizationId, scope.organizationId),
        eq(githubConnections.memberId, member.id),
      )).limit(1);
      return connection;
    });
  }

  save(scope: WorkspaceScope, input: { githubUserId: string; login: string; credentialCiphertext: string }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      const [connection] = await transaction.insert(githubConnections).values({
        organizationId: scope.organizationId,
        memberId: member.id,
        ...input,
      }).onConflictDoUpdate({
        target: [githubConnections.organizationId, githubConnections.memberId],
        set: { ...input, updatedAt: new Date() },
      }).returning();
      if (!connection) throw new Error("Failed to save the GitHub connection.");
      return connection;
    });
  }

  remove(scope: WorkspaceScope) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      await transaction.delete(githubConnections).where(and(
        eq(githubConnections.organizationId, scope.organizationId),
        eq(githubConnections.memberId, member.id),
      ));
    });
  }
}
