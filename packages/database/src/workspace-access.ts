export {
  requireConversationAccess,
  requireProjectAccess,
  requireWorkspaceMember,
  WorkspaceAccessError,
  type WorkspaceScope,
} from "./workspace.js";

import { and, eq, or } from "drizzle-orm";
import type { DatabaseTransaction } from "./client.js";
import { conversationGrants, conversations, missions, projectMembers, projectRepositories, projects } from "./schema.js";

// Recheck delegated project access when execution or an approval resumes.
export async function hasWorkspaceMissionAuthority(transaction: DatabaseTransaction, mission: typeof missions.$inferSelect) {
  if (mission.context.workspaceVersion !== 1) return true;
  if (!mission.projectId || !mission.assignedDeviceId || typeof mission.context.repositoryId !== "string") return false;
  const [authorized] = await transaction.select({ id: conversations.id }).from(conversations)
    .innerJoin(projects, and(eq(projects.organizationId, conversations.organizationId), eq(projects.id, conversations.projectId)))
    .innerJoin(projectRepositories, and(eq(projectRepositories.organizationId, projects.organizationId), eq(projectRepositories.projectId, projects.id),
      eq(projectRepositories.deviceId, mission.assignedDeviceId), eq(projectRepositories.repositoryId, mission.context.repositoryId)))
    .leftJoin(projectMembers, and(eq(projectMembers.organizationId, projects.organizationId), eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, mission.requestedByMemberId)))
    .leftJoin(conversationGrants, and(eq(conversationGrants.organizationId, conversations.organizationId), eq(conversationGrants.conversationId, conversations.id), eq(conversationGrants.memberId, mission.requestedByMemberId)))
    .where(and(eq(conversations.organizationId, mission.organizationId), eq(conversations.id, mission.conversationId), eq(projects.id, mission.projectId),
      or(eq(projects.ownerMemberId, mission.requestedByMemberId), eq(projectMembers.memberId, mission.requestedByMemberId)),
      or(eq(conversations.ownerMemberId, mission.requestedByMemberId), eq(conversationGrants.memberId, mission.requestedByMemberId))))
    .limit(1);
  return Boolean(authorized);
}
